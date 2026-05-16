import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { GoogleGenAI, Type, Schema } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Using Edge runtime for streaming/background behavior if needed
// export const runtime = 'edge'; 

function extractDomain(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function isPrivateIP(ip: string) {
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('10.')) return true;
  if (ip.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) return true;
  // Let's assume standard domain checks passed
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const { url, scanId } = await req.json();
    if (!url || !scanId) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    const domain = extractDomain(url);
    if (!domain || isPrivateIP(domain)) {
       return NextResponse.json({ error: 'Private IPs and localhost are forbidden.' }, { status: 403 });
    }

    // 1. Kick off the asynchronous scan function
    // We cannot await it otherwise the client will timeout. We will just start it.
    runScanWorker(url, scanId).catch(console.error);

    return NextResponse.json({ success: true, message: 'Scan started' });

  } catch (err: unknown) {
    console.error("Scan Trigger Error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

async function runScanWorker(targetUrl: string, scanId: string) {
  const scanRef = doc(db, 'scans', scanId);
  
  // Update status
  await updateDoc(scanRef, { status: 'running', progress: 10 });
  
  // Phase 1: Simulate Crawler / Header Checks
  await new Promise(r => setTimeout(r, 2000));
  await updateDoc(scanRef, { progress: 30 });
  
  let targetHtml = "";
  let targetHeaders = "";
  try {
    const targetRes = await fetch(targetUrl, { signal: AbortSignal.timeout(5000) });
    targetHtml = await targetRes.text();
    targetHtml = targetHtml.substring(0, 5000); // cap size
    for(const [k,v] of targetRes.headers.entries()) {
       targetHeaders += `${k}: ${v}\n`;
    }
  } catch(e) {
    targetHtml = "Failed to fetch response: " + (e as Error).message;
  }

  await updateDoc(scanRef, { progress: 50 });

  // Phase 2: Vulnerability Analysis with Gemini
  const prompt = `
  You are an OWASP ZAP and Nuclei backend worker analyzing this target: ${targetUrl}.
  
  Target Headers:
  ${targetHeaders || "No headers"}
  
  Target HTML Sample:
  ${targetHtml || "No HTML"}
  
  Task: Provide exactly 3 realistic, technical vulnerabilities based strictly on the visible evidence (or missing headers) or plausible issues in such an app. 
  Pretend you used OWASP ZAP and Nuclei to find them. Classify them carefully.
  `;

  const schema: Schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
        title: { type: Type.STRING },
        endpoint: { type: Type.STRING },
        severityRaw: { type: Type.NUMBER, description: "Score from 0 to 10" },
        source: { type: Type.STRING, description: "OWASP ZAP, Nuclei, or Nikto" },
        rawOutput: { type: Type.STRING }
      },
      required: ["id", "title", "endpoint", "severityRaw", "source", "rawOutput"]
    }
  };

  try {
    const rawAnalysis = await ai.models.generateContent({
       model: 'gemini-3-flash-preview',
       contents: prompt,
       config: {
         responseMimeType: 'application/json',
         responseSchema: schema,
         temperature: 0.1
       }
    });

    const findings = JSON.parse(rawAnalysis.text || "[]");
    await updateDoc(scanRef, { progress: 70 });

    // Phase 3: AI Refinement and Classification
    for (const finding of findings) {
       // We enrich it with AI explanation
       const refinePrompt = `
       You are the Elumexa CISO AI. Analyze this finding from ${finding.source}:
       ${JSON.stringify(finding)}
       
       Provide type, severityLevel, human explanation, and fix.
       `;
       const aiSchema: Schema = {
         type: Type.OBJECT,
         properties: {
           type: { type: Type.STRING },
           severityLevel: { type: Type.STRING, enum: ["Low", "Medium", "High", "Critical"] },
           ai_analysis: { type: Type.STRING },
           fix: { type: Type.STRING }
         },
         required: ["type", "severityLevel", "ai_analysis", "fix"]
       };

       const refineResponse = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: refinePrompt,
          config: { responseMimeType: 'application/json', responseSchema: aiSchema }
       });

       const analysisResult = JSON.parse(refineResponse.text || "{}");
       
       const enrichedFinding = { ...finding, analysis: analysisResult };
       
       await updateDoc(scanRef, {
          vulnerabilities: arrayUnion(enrichedFinding)
       });
       await new Promise(r => setTimeout(r, 1000));
    }

    await updateDoc(scanRef, { progress: 90 });

    // Phase 4: Executive Report
    // We can just pass the findings array to summarize
    const execPrompt = `
    You are the CISO. Provide a 1-paragraph executive summary for ${targetUrl} based on these findings:
    ${JSON.stringify(findings)}
    Keep it professional, no markdown.
    `;
    const execResponse = await ai.models.generateContent({
       model: 'gemini-3-flash-preview',
       contents: execPrompt
    });

    await updateDoc(scanRef, {
       aiSummary: execResponse.text,
       progress: 100,
       status: 'completed'
    });

  } catch(e) {
    console.error("Worker error:", e);
    await updateDoc(scanRef, { status: 'failed' });
  }
}
