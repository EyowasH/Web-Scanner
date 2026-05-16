'use client';

import { useState, useRef, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '@/lib/firestore-error';

export default function Dashboard() {
  const [url, setUrl] = useState('');
  const [scanId, setScanId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [logs, setLogs] = useState<string[]>(['[SYSTEM] ELUMEXA_GUARD ENGINE STANDBY']);
  const [findings, setFindings] = useState<Record<string, unknown>[]>([]);
  const [progress, setProgress] = useState(0);
  const [scannedNodes, setScannedNodes] = useState(0);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visitorId] = useState(() => Math.random().toString(36).substring(2, 10));
  
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, msg].slice(-100));
  };

  const calculateOverallSeverity = () => {
    if (findings.length === 0) return 0;
    const max = Math.max(...findings.map(f => Number(f.severityRaw) || 0));
    return max.toFixed(1);
  };

  const getSeverityCounts = () => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    findings.forEach(f => {
      const sev = Number(f.severityRaw) || 0;
      if (sev >= 9.0) counts.critical++;
      else if (sev >= 7.0) counts.high++;
      else if (sev >= 4.0) counts.medium++;
      else counts.low++;
    });
    return counts;
  };

  const generateId = () => Math.random().toString(36).substring(2, 10);

  const startScan = async () => {
    if (!url) {
      setError("Please enter a valid URL.");
      return;
    }
    try {
      new URL(url);
    } catch {
      setError("Please enter a valid URL including http:// or https://");
      return;
    }
    
    setError(null);
    setIsScanning(true);
    setFindings([]);
    setLogs([]);
    setProgress(0);
    setScannedNodes(0);
    setAiSummary(null);
    
    const newScanId = generateId();
    setScanId(newScanId);
    addLog(`[SYSTEM] SCANNER_ENGINE_V4.2.1 AUTHENTICATED FOR ${url}`);

    try {
      // 1. Create document in Firestore First
      const docRef = doc(db, 'scans', newScanId);
      await setDoc(docRef, {
        url,
        status: 'running',
        progress: 0,
        userId: visitorId,
        createdAt: serverTimestamp()
      });
      addLog(`[INFO] Scan job ${newScanId} registered in database.`);

      // 2. Trigger Next.js background worker
      const res = await fetch('/api/scan/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, scanId: newScanId })
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to start worker');
      }

    } catch (e: unknown) {
      const err = e as Error;
      if(err.message && err.message.includes('permissions')) {
        handleFirestoreError(err, OperationType.CREATE, 'scans');
      }
      setIsScanning(false);
      setError(err.message || "Failed to start scan");
      addLog(`[CRITICAL] Error starting scan: ${err.message}`);
    }
  };

  // 3. Listen for Firestore updates
  useEffect(() => {
    if (!scanId) return;

    const unsubscribe = onSnapshot(doc(db, 'scans', scanId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        
        if (data.progress !== undefined && data.progress !== progress) {
          setProgress(data.progress);
          // Simulate nodes
          setScannedNodes(Math.floor(data.progress * 14.5)); 
          if(data.progress === 10) addLog("[INFO] Initializing active scan and fetching pages...");
          if(data.progress === 30) addLog("[INFO] Crawling complete. Analyzing headers...");
          if(data.progress === 70) addLog("[AI] Passing raw outputs to Gemini classification pipeline...");
          if(data.progress === 90) addLog("[AI] Findings classified. Preparing executive report...");
        }

        if (data.vulnerabilities?.length > findings.length) {
          const newFinds = data.vulnerabilities.slice(findings.length);
          newFinds.forEach((f: Record<string, unknown>) => {
            addLog(`[CRITICAL] Finding classified: ${String(f.title)}`);
          });
          setFindings(data.vulnerabilities);
        }

        if (data.aiSummary && data.aiSummary !== aiSummary) {
          setAiSummary(data.aiSummary);
        }

        if (data.status === 'completed' || data.status === 'failed') {
          setIsScanning(false);
          addLog(data.status === 'completed' ? `[SYSTEM] SCAN COMPLETED.` : `[SYSTEM] SCAN FAILED.`);
        }
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'scans');
    });

    return () => unsubscribe();
  }, [scanId, findings.length, progress, aiSummary]);

  const sevCounts = getSeverityCounts();
  const overallSeverity = calculateOverallSeverity();

  return (
    <div className="h-screen w-full bg-[#020202] text-slate-300 font-sans flex flex-col overflow-hidden select-none">
      {/* TOP NAVIGATION BAR */}
      <nav className="h-14 shrink-0 border-b border-white/5 flex items-center justify-between px-6 bg-[#050505]/50 backdrop-blur-md">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-red-600 rounded flex items-center justify-center">
              <span className="text-white font-bold text-xs">E</span>
            </div>
            <span className="text-white font-semibold tracking-wider text-sm">
              ELUMEXA <span className="text-red-500">FREE SCAN</span>
            </span>
          </div>
          <div className="h-4 w-px bg-white/10 hidden sm:block"></div>
          <div className="items-center gap-4 text-xs font-medium hidden sm:flex">
             <span className="text-white cursor-pointer transition-colors border-b border-emerald-500 pb-1">INSTANT SCAN</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-[10px] bg-emerald-500/10 text-emerald-500 px-3 py-1 rounded-full border border-emerald-500/20">
            <div className={`w-1.5 h-1.5 bg-emerald-500 rounded-full ${isScanning ? "animate-pulse" : ""}`}></div>
            {isScanning ? "SCAN IN PROGRESS" : "SYSTEMS READY"}
          </div>
        </div>
      </nav>

      {/* MAIN INTERFACE */}
      <main className="flex-1 p-4 grid grid-cols-1 md:grid-cols-12 grid-rows-none md:grid-rows-12 gap-4 h-[calc(100vh-3.5rem)] overflow-y-auto md:overflow-hidden">
        
        {/* SCAN INPUT SECTION */}
        <div className="md:col-span-12 md:row-span-1 bg-[#0A0A0A] border border-white/5 rounded-lg flex flex-col md:flex-row items-center px-4 gap-4 h-auto md:h-14 shrink-0 py-2 md:py-0">
          <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest hidden lg:block">Target URL</div>
          <input 
            type="text" 
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isScanning}
            className="flex-1 w-full bg-black/40 border border-white/10 outline-none focus:border-white/20 rounded px-3 py-2 text-sm font-mono text-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed" 
            placeholder="https://example.com"
          />
          {error && <div className="text-red-500 text-[10px] font-mono">{error}</div>}
          <button 
            onClick={startScan}
            disabled={isScanning || !url}
            className="w-full md:w-auto flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 transition-colors text-white px-6 py-2 rounded text-xs font-bold uppercase tracking-tighter disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>{isScanning ? "Scanning..." : "Scan Now"}</span>
          </button>
        </div>

        {/* LEFT COLUMN: RISK METRICS */}
        <div className="md:col-span-3 md:row-span-9 lg:row-span-10 flex flex-col gap-4">
          <div className="flex-1 bg-[#0A0A0A] border border-white/5 rounded-lg p-4 flex flex-col items-center justify-center text-center">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Threat Risk Score</div>
            <div className="relative flex items-center justify-center">
              <svg className="w-32 h-32 transform -rotate-90">
                <circle cx="64" cy="64" r="58" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-white/5" />
                <circle cx="64" cy="64" r="58" stroke="currentColor" strokeWidth="8" fill="transparent" strokeDasharray="364" strokeDashoffset={364 - (364 * (Number(overallSeverity) / 10))} className="text-red-600 transition-all duration-1000 ease-out" />
              </svg>
              <div className="absolute flex flex-col">
                <span className="text-4xl font-bold text-white leading-none">{overallSeverity}</span>
                <span className={`text-[10px] font-bold uppercase mt-1 ${Number(overallSeverity) >= 9.0 ? 'text-red-500' : Number(overallSeverity) >= 7.0 ? 'text-orange-500' : Number(overallSeverity) >= 4.0 ? 'text-amber-400' : 'text-emerald-500'}`}>
                   {Number(overallSeverity) >= 9.0 ? 'Critical' : Number(overallSeverity) >= 7.0 ? 'High' : Number(overallSeverity) >= 4.0 ? 'Medium' : findings.length > 0 ? 'Low' : 'None'}
                </span>
              </div>
            </div>
          </div>
          <div className="flex-1 bg-[#0A0A0A] border border-white/5 rounded-lg p-4 flex flex-col">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4">Severity Index</div>
            <div className="space-y-4 flex-1 flex flex-col justify-center">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-red-600"></div> Critical</span>
                <span className="text-white font-mono">{sevCounts.critical.toString().padStart(2, '0')}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-orange-500"></div> High</span>
                <span className="text-white font-mono">{sevCounts.high.toString().padStart(2, '0')}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-amber-400"></div> Medium</span>
                <span className="text-white font-mono">{sevCounts.medium.toString().padStart(2, '0')}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-blue-500"></div> Low</span>
                <span className="text-white font-mono">{sevCounts.low.toString().padStart(2, '0')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* CENTER PANEL: LIVE FINDINGS */}
        <div className="md:col-span-6 md:row-span-9 lg:row-span-10 bg-[#0A0A0A] border border-white/5 rounded-lg p-0 flex flex-col overflow-hidden min-h-[400px]">
          <div className="p-4 border-b border-white/5 flex items-center justify-between shrink-0">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Real-time Vulnerability Feed</div>
            <div className="text-[10px] text-emerald-500 font-mono">{findings.length} Findings Detected</div>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-white/5">
            {findings.length === 0 ? (
               <div className="h-full flex items-center justify-center text-xs text-slate-600 font-mono italic">
                  {isScanning ? 'Scanning endpoint... waiting for telemetry.' : 'No scan data. Enter an endpoint to begin.'}
               </div>
            ) : null}
            {findings.map((f, i) => {
              const sev = Number(f.severityRaw) || 0;
              const isCrit = sev >= 9.0;
              const isHigh = sev >= 7.0 && sev < 9.0;
              const isMed = sev >= 4.0 && sev < 7.0;
              const bgClass = isCrit ? 'bg-red-600' : isHigh ? 'bg-orange-600' : isMed ? 'bg-amber-600' : 'bg-blue-600';
              const rowBg = isCrit ? 'bg-red-600/5' : 'bg-transparent';
              
              const fAnalysisType = (f.analysis as Record<string, unknown>)?.type;
              return (
                <div key={i} className={`p-4 flex items-start gap-4 ${rowBg}`}>
                  <div className={`${bgClass} text-white text-[8px] px-2 py-1 rounded font-bold uppercase mt-1 min-w-[50px] text-center`}>
                    {typeof fAnalysisType === 'string' ? fAnalysisType.substring(0, 8) : 'DETECT'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-white mb-1 truncate" title={String(f.title)}>{String(f.title)}</div>
                    <div className="text-[10px] font-mono text-slate-500 mb-2 underline truncate">{String(f.endpoint)}</div>
                    <div className="bg-black/50 p-2 rounded text-[10px] border border-white/5 font-mono text-slate-400">
                      {f.analysis ? (
                        <>
                          <span className="text-red-400">[AI Insight]</span> {String((f.analysis as Record<string, unknown>).ai_analysis)}
                          <div className="mt-2 text-emerald-400">
                            <span className="font-bold">Fix: </span>{String((f.analysis as Record<string, unknown>).fix)}
                          </div>
                          <div className="mt-2 flex items-center justify-between">
                            <span><span className="text-slate-500">Tool:</span> <span className="text-blue-400 underline">{String(f.source)}</span></span>
                          </div>
                        </>
                      ) : (
                        <div className="flex items-center gap-2">
                           <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></div>
                           <span>Analyzing telemetry...</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT PANEL: AI ANALYSIS & LOGS */}
        <div className="md:col-span-3 md:row-span-9 lg:row-span-10 flex flex-col gap-4">
          <div className="flex-1 bg-[#0A0A0A] border border-white/5 rounded-lg p-4 flex flex-col">
            <div className="flex items-center gap-2 mb-4 shrink-0">
              <div className="w-3 h-3 rounded-full bg-blue-500 flex items-center justify-center">
                 <div className="w-1 h-1 bg-white rounded-full animate-pulse"></div>
              </div>
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Gemini CISO Summary</div>
            </div>
            <div className="flex-1 overflow-y-auto mb-4">
              <div className="text-xs italic leading-relaxed text-slate-300">
                {aiSummary ? `"${aiSummary}"` : isScanning ? "Analyzing overall posture..." : "Executive report will appear here."}
              </div>
            </div>
          </div>
          <div className="flex-1 bg-black border border-white/10 rounded-lg p-3 font-mono text-[9px] overflow-y-auto min-h-[150px]">
            {logs.map((log, i) => {
              let colorClasses = "text-slate-500";
              if (log.includes("[SYSTEM]")) colorClasses = "text-emerald-500";
              else if (log.includes("[CRITICAL]")) colorClasses = "text-red-500 font-bold";
              else if (log.includes("[AI]")) colorClasses = "text-blue-400";
              else if (log.includes("[INFO]")) colorClasses = "text-slate-400";

              return (
                <div key={i} className={`mb-1 ${colorClasses}`}>
                  {log}
                </div>
              );
            })}
            {isScanning && (
               <div className="text-emerald-500 animate-pulse mt-1">_</div>
            )}
            <div ref={logsEndRef} />
          </div>
        </div>

        {/* BOTTOM ROW: SCAN PROGRESS */}
        <div className="md:col-span-12 md:row-span-2 lg:row-span-1 bg-[#0A0A0A] border border-white/5 rounded-lg p-4 flex flex-col justify-center">
           <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Overall Progress</div>
              <div className="flex gap-4 sm:gap-8">
                <div className="flex flex-col">
                   <span className="text-[10px] text-slate-500 uppercase hidden sm:block">Scanned Nodes</span>
                   <span className="text-sm text-white font-mono">{scannedNodes.toString().padStart(4, '0')}</span>
                </div>
              </div>
           </div>
           <div className="h-1.5 sm:h-2 bg-white/5 rounded-full overflow-hidden">
             <div 
               className="h-full bg-emerald-500 transition-all duration-300 shadow-[0_0_15px_rgba(16,185,129,0.5)]" 
               style={{ width: `${progress}%` }}
             ></div>
           </div>
           <div className="flex flex-col sm:flex-row sm:items-center justify-between mt-3 gap-2">
              <div className="flex flex-wrap gap-4 text-[9px] font-mono text-slate-500">
                <span className={`flex items-center gap-1 ${isScanning ? 'text-emerald-500' : ''}`}><div className={`w-1.5 h-1.5 bg-emerald-500 rounded-full ${isScanning ? 'animate-pulse' : 'opacity-30'}`}></div> ZAP ENGINE ACTIVE</span>
                <span className={`flex items-center gap-1 ${progress > 20 && isScanning ? 'text-emerald-500' : ''}`}><div className={`w-1.5 h-1.5 bg-emerald-500 rounded-full ${progress > 20 && isScanning ? 'animate-pulse' : 'opacity-30'}`}></div> NUCLEI ACTIVE</span>
                <span className={`flex items-center gap-1 ${progress > 50 && isScanning ? 'text-blue-500' : ''}`}><div className={`w-1.5 h-1.5 bg-blue-500 rounded-full ${progress > 50 && isScanning ? 'animate-pulse' : 'opacity-30'}`}></div> AI CLASSIFIER READY</span>
              </div>
           </div>
        </div>

      </main>
    </div>
  );
}

