"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { User, Code2, Briefcase, Network, MessageSquare, Play, Pause, RotateCcw, Zap, Terminal, Search, Plus } from "lucide-react";

// --- Types ---

type AgentRole = "Human" | "Manager" | "Architect" | "Coder";
type AgentStatus = "IDLE" | "BUSY" | "WAKING";

interface Agent {
  id: string;
  role: AgentRole;
  label: string;
  status: AgentStatus;
  inbox: number; 
  x: number;
  y: number;
}

interface Message {
  id: number;
  fromId: string;
  toId: string;
  content: string;
  timestamp: string;
  status: "SENT" | "BUFFERED" | "PROCESSED";
}

interface Beam {
  id: number;
  fromPos: { x: number, y: number };
  toPos: { x: number, y: number };
  type: 'MSG' | 'CREATE';
  color: string;
}

// --- Visual Components ---

const AgentNode = ({ agent, onClick, isSelected }: { agent: Agent, onClick: (e: any) => void, isSelected: boolean }) => {
  const isHuman = agent.role === "Human";
  const Icon = isHuman ? User : agent.role === "Manager" ? Briefcase : agent.role === "Architect" ? Network : Code2;
  
  let ringColor = "border-zinc-700";
  let glow = "";
  
  if (agent.status === "BUSY") {
    ringColor = "border-red-500";
    glow = "shadow-[0_0_30px_rgba(239,68,68,0.4)]";
  } else if (agent.status === "WAKING") {
    ringColor = "border-yellow-400";
    glow = "shadow-[0_0_30px_rgba(250,204,21,0.6)]";
  } else {
    ringColor = isHuman ? "border-white" : "border-green-500";
    glow = isHuman ? "shadow-[0_0_20px_rgba(255,255,255,0.2)]" : "shadow-[0_0_15px_rgba(74,222,128,0.1)]";
  }

  return (
    <motion.div
      layoutId={agent.id}
      initial={{ scale: 0, opacity: 0, x: agent.x, y: agent.y }}
      animate={{ scale: 1, opacity: 1, x: agent.x, y: agent.y }}
      transition={{ type: "spring", stiffness: 260, damping: 20 }}
      className="absolute -ml-10 -mt-10 cursor-pointer group z-20"
      onClick={onClick}
    >
      {isSelected && (
        <motion.div 
          layoutId="selection"
          className="absolute -inset-4 border border-zinc-500 rounded-full opacity-50"
          transition={{ duration: 0.2 }}
        />
      )}

      <div className={`w-20 h-20 rounded-full bg-black border-2 ${ringColor} ${glow} flex items-center justify-center relative transition-all duration-300`}>
        <Icon size={24} className={isHuman ? "text-white" : "text-zinc-200"} />
        {agent.status === "BUSY" && (
           <motion.div 
             className="absolute inset-0 border-2 border-t-transparent border-r-transparent border-red-500 rounded-full"
             animate={{ rotate: 360 }}
             transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
           />
        )}
      </div>

      <div className="absolute top-24 left-1/2 -translate-x-1/2 text-center w-32 pointer-events-none">
        <div className="text-xs font-bold text-zinc-300 shadow-black drop-shadow-md">{agent.label}</div>
        <div className={`text-[9px] font-mono ${agent.status === "BUSY" ? "text-red-400" : agent.status === "WAKING" ? "text-yellow-400" : "text-zinc-500"}`}>
          {agent.status}
        </div>
      </div>

      <AnimatePresence>
        {agent.inbox > 0 && Array.from({ length: agent.inbox }).map((_, i) => (
          <motion.div
            key={`inbox-${i}`}
            initial={{ scale: 0 }}
            animate={{ 
              scale: 1,
              rotate: 360,
              x: Math.cos(i * 1.5) * 35, 
              y: Math.sin(i * 1.5) * 35 
            }}
            exit={{ scale: 0, x: 0, y: 0 }} 
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            className="absolute top-1/2 left-1/2 w-3 h-3 bg-white rounded-full shadow-[0_0_10px_white] z-30 pointer-events-none"
          />
        ))}
      </AnimatePresence>
    </motion.div>
  );
};

const LaserBeam = ({ beam }: { beam: Beam }) => {
  const isCreate = beam.type === 'CREATE';
  
  return (
    <svg className="absolute inset-0 pointer-events-none overflow-visible z-10 w-full h-full">
      {/* Background Track */}
      <motion.line
        x1={beam.fromPos.x} y1={beam.fromPos.y} x2={beam.toPos.x} y2={beam.toPos.y}
        stroke={beam.color}
        strokeWidth={isCreate ? "2" : "1"}
        strokeDasharray={isCreate ? "4 4" : "none"}
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: isCreate ? 0.3 : 0.1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.5 }}
      />
      
      {/* Moving Particle */}
      <motion.circle
        r={isCreate ? "8" : "4"}
        fill={beam.color}
        initial={{ cx: beam.fromPos.x, cy: beam.fromPos.y, opacity: 1, scale: 0 }}
        animate={{ cx: beam.toPos.x, cy: beam.toPos.y, opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 2 }}
        transition={{ duration: 0.8, ease: "easeInOut" }}
        style={{ 
          filter: `drop-shadow(0 0 ${isCreate ? '12px' : '4px'} ${beam.color})`
        }}
      />
      
      {/* Extra flare for creation */}
      {isCreate && (
        <motion.circle
          r="15"
          fill={beam.color}
          initial={{ cx: beam.fromPos.x, cy: beam.fromPos.y, opacity: 0, scale: 0 }}
          animate={{ cx: beam.toPos.x, cy: beam.toPos.y, opacity: [0, 0.4, 0], scale: [0.5, 1.5, 0.5] }}
          transition={{ duration: 0.8, ease: "easeInOut" }}
          style={{ filter: 'blur(8px)' }}
        />
      )}
    </svg>
  );
};

// --- Main Page ---

export default function DemoPage() {
  const [agents, setAgents] = useState<Agent[]>([
    { id: "human", role: "Human", label: "Human", status: "IDLE", inbox: 0, x: 100, y: 300 }
  ]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeBeams, setActiveBeams] = useState<Beam[]>([]);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeContactId, setActiveContactId] = useState<string>("mgr");
  const [myIdentityId, setMyIdentityId] = useState<string>("human");

  const agentsRef = useRef(agents);
  useEffect(() => { agentsRef.current = agents; }, [agents]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeContactId]);

  // --- Director Script ---
  useEffect(() => {
    if (!isPlaying) return;
    let timeouts: NodeJS.Timeout[] = [];
    const schedule = (fn: () => void, ms: number) => timeouts.push(setTimeout(fn, ms));

    const spawnAgent = (fromId: string, newId: string, role: AgentRole, label: string, x: number, y: number) => {
       const fromAgent = agentsRef.current.find(a => a.id === fromId) || { x: 0, y: 0 };
       const beamId = Date.now() + Math.random();
       
       setActiveBeams(prev => [...prev, { 
         id: beamId, 
         fromPos: { x: fromAgent.x, y: fromAgent.y }, 
         toPos: { x, y }, 
         type: 'CREATE',
         color: "#3b82f6" 
       }]);

       schedule(() => {
         setAgents(prev => [...prev, { id: newId, role, label, status: "IDLE", inbox: 0, x, y }]);
         addMessage("system", fromId, `System: ${label} hired.`);
         setActiveBeams(prev => prev.filter(b => b.id !== beamId));
       }, 800);
    };

    const sendMsg = (fromId: string, toId: string, content: string, shouldBuffer: boolean) => {
       const fromA = agentsRef.current.find(a => a.id === fromId);
       const toA = agentsRef.current.find(a => a.id === toId);
       if (!fromA || !toA) return;

       const beamId = Date.now() + Math.random();
       setActiveBeams(prev => [...prev, { 
         id: beamId, 
         fromPos: { x: fromA.x, y: fromA.y }, 
         toPos: { x: toA.x, y: toA.y }, 
         type: 'MSG',
         color: "#fff"
       }]);

       schedule(() => {
         if (shouldBuffer) {
           updateAgent(toId, a => ({ inbox: a.inbox + 1 }));
           addMessage(fromId, toId, content, "BUFFERED");
         } else {
           addMessage(fromId, toId, content, "SENT");
         }
         setActiveBeams(prev => prev.filter(b => b.id !== beamId));
       }, 800);
    };

    // Script
    schedule(() => addMessage("system", "human", "System: Simulation Initialized."), 100);
    schedule(() => addMessage("human", "mgr", "Build a Snake Game."), 1000);

    // 2. Spawn Manager
    schedule(() => spawnAgent("human", "mgr", "Manager", "Manager", 300, 300), 1500);
    schedule(() => addMessage("mgr", "human", "Received. Hiring team..."), 2500);

    // 3. Manager Busy -> Hire Architect
    schedule(() => updateAgent("mgr", a => ({ status: "BUSY" })), 3000);
    schedule(() => {
      spawnAgent("mgr", "arch", "Architect", "Architect", 500, 200);
      updateAgent("mgr", a => ({ status: "IDLE" }));
    }, 4500);

    // 4. Architect hires Coder
    schedule(() => updateAgent("arch", a => ({ status: "BUSY" })), 5500);
    schedule(() => {
      spawnAgent("arch", "coder", "Coder", "Coder", 700, 400);
      updateAgent("arch", a => ({ status: "IDLE" }));
    }, 7000);

    // 5. Task Cascade
    schedule(() => sendMsg("arch", "coder", "Task: Implement Core Loop", false), 8000);
    
    // 6. Coder Busy
    schedule(() => updateAgent("coder", a => ({ status: "BUSY" })), 9000);

    // 7. Human Intervention
    schedule(() => sendMsg("human", "coder", "Wait! Make it 3D!", true), 11000);

    // 8. Coder Wakes
    schedule(() => updateAgent("coder", a => ({ status: "WAKING" })), 14000);
    
    schedule(() => {
      updateAgent("coder", a => ({ status: "BUSY", inbox: 0 })); 
      setMessages(prev => prev.map(m => m.toId === "coder" && m.status === "BUFFERED" ? { ...m, status: "PROCESSED" } : m));
      addMessage("coder", "human", "Got it. 3D mode enabled.", "SENT");
    }, 15500);

    return () => timeouts.forEach(clearTimeout);
  }, [isPlaying]);

  // Helpers
  const updateAgent = (id: string, fn: (a: Agent) => Partial<Agent>) => {
    setAgents(prev => prev.map(a => a.id === id ? { ...a, ...fn(a) } : a));
  };

  const addMessage = (fromId: string, toId: string, content: string, status: Message['status'] = "SENT") => {
    setMessages(prev => [...prev, {
      id: Date.now() + Math.random(), fromId, toId, content,
      timestamp: new Date().toLocaleTimeString('en-US', {hour12:false, hour:"2-digit", minute:"2-digit"}),
      status
    }]);
  };

  const reset = () => {
    setIsPlaying(false);
    setAgents([{ id: "human", role: "Human", label: "Human", status: "IDLE", inbox: 0, x: 100, y: 300 }]);
    setMessages([]);
    setActiveBeams([]);
  };

  const contacts = agents.filter(a => a.id !== myIdentityId);
  const chatMessages = messages.filter(m => 
    (m.fromId === myIdentityId && m.toId === activeContactId) || 
    (m.fromId === activeContactId && m.toId === myIdentityId) ||
    (m.fromId === "system" && m.toId === myIdentityId) 
  );

  return (
    <div className="flex h-screen bg-black text-zinc-200 font-sans overflow-hidden">
      
      {/* IM Sidebar */}
      <div className="w-64 flex flex-col border-r border-zinc-900 bg-zinc-950 z-30">
        <div className="h-16 flex items-center px-4 border-b border-zinc-900 font-bold text-white bg-black/20">
          <MessageSquare size={18} className="mr-2 text-blue-500" /> Chats
        </div>
        
        <div className="flex-1 overflow-y-auto">
          {contacts.map(contact => {
             const lastMsg = messages.filter(m => 
               (m.fromId === contact.id && m.toId === myIdentityId) || (m.fromId === myIdentityId && m.toId === contact.id)
             ).pop();

             const isSelected = activeContactId === contact.id;

             return (
               <div 
                 key={contact.id} 
                 onClick={() => setActiveContactId(contact.id)}
                 className={`p-3 flex items-center gap-3 cursor-pointer hover:bg-zinc-900 transition-colors ${isSelected ? "bg-zinc-900 border-l-2 border-blue-500" : "border-l-2 border-transparent"}`}
               >
                 <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center border border-zinc-700 relative">
                    {contact.role === "Manager" ? <Briefcase size={16}/> : 
                     contact.role === "Architect" ? <Network size={16}/> : <Code2 size={16}/>}
                    
                    <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-zinc-900 ${
                      contact.status === "BUSY" ? "bg-red-500" : 
                      contact.status === "WAKING" ? "bg-yellow-500" : "bg-green-500"
                    }`}></div>
                 </div>
                 
                 <div className="flex-1 min-w-0">
                   <div className="flex justify-between items-baseline">
                     <span className="font-medium text-sm text-zinc-200 truncate">{contact.label}</span>
                     <span className="text-[10px] text-zinc-600">{lastMsg?.timestamp}</span>
                   </div>
                   <div className="text-xs text-zinc-500 truncate">
                     {lastMsg ? (lastMsg.fromId === myIdentityId ? `You: ${lastMsg.content}` : lastMsg.content) : <span className="italic opacity-50">No messages</span>}
                   </div>
                 </div>
               </div>
             );
          })}
        </div>
      </div>

      {/* IM Main */}
      <div className="w-96 flex flex-col border-r border-zinc-900 bg-black z-30 shadow-2xl">
        <div className="h-16 flex items-center justify-between px-6 border-b border-zinc-900 bg-zinc-950/50 backdrop-blur">
           <span className="font-bold text-white">{contacts.find(c => c.id === activeContactId)?.label || "Select Chat"}</span>
           <div className="flex gap-2">
             <div className="w-3 h-3 rounded-full bg-zinc-800"></div>
             <div className="w-3 h-3 rounded-full bg-zinc-800"></div>
           </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-zinc-950 to-black">
           {chatMessages.length === 0 ? (
             <div className="h-full flex flex-col items-center justify-center text-zinc-700 space-y-2">
                <MessageSquare size={32} />
                <p className="text-sm">Start a conversation</p>
             </div>
           ) : (
             chatMessages.map(msg => {
               const isMe = msg.fromId === myIdentityId;
               return (
                 <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] p-3 rounded-2xl text-sm leading-relaxed ${
                      isMe 
                        ? "bg-blue-600 text-white rounded-tr-none" 
                        : "bg-zinc-800 text-zinc-200 rounded-tl-none border border-zinc-700"
                    } ${msg.status === "BUFFERED" ? "opacity-50 border-dashed border-zinc-500" : ""}`}>
                      {msg.content}
                      {msg.status === "BUFFERED" && <div className="text-[9px] mt-1 font-mono uppercase opacity-70 flex items-center gap-1"><Zap size={8}/> Buffered in Inbox</div>}
                    </div>
                 </div>
               )
             })
           )}
           <div ref={messagesEndRef} />
        </div>

        <div className="p-4 border-t border-zinc-900 bg-zinc-950">
          <div className="bg-zinc-900 rounded-full px-4 py-2 flex items-center gap-2 border border-zinc-800">
            <input disabled className="flex-1 bg-transparent text-sm text-zinc-300 outline-none cursor-not-allowed" placeholder="Watching simulation..." />
            <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-white cursor-pointer opacity-50">
              <Plus size={14} />
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel: Infinite Canvas */}
      <div className="flex-1 relative bg-black overflow-hidden cursor-move">
         <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:50px_50px]"></div>
         
         <div className="absolute top-6 left-6 z-40">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-zinc-900/80 border border-zinc-800 rounded-full text-xs text-zinc-400 backdrop-blur">
               <Terminal size={12} className="text-green-500"/>
               <span>Global Topology View</span>
            </div>
         </div>

         <div className="absolute bottom-8 right-8 flex gap-4 z-50">
            {!isPlaying ? (
              <button onClick={() => setIsPlaying(true)} className="flex items-center gap-2 px-6 py-3 bg-white text-black rounded-full font-bold hover:bg-zinc-200 shadow-[0_0_20px_rgba(255,255,255,0.2)] transition-all">
                <Play size={18} fill="black" /> Run Demo
              </button>
            ) : (
              <button onClick={() => setIsPlaying(false)} className="flex items-center gap-2 px-6 py-3 bg-zinc-900 text-white border border-zinc-700 rounded-full font-bold">
                <Pause size={18} fill="white" /> Pause
              </button>
            )}
            <button onClick={reset} className="p-3 bg-zinc-900 border border-zinc-700 rounded-full text-zinc-400 hover:text-white transition-colors">
              <RotateCcw size={18} />
            </button>
         </div>

         {/* Beams Area */}
         <AnimatePresence>
           {activeBeams.map(beam => (
             <LaserBeam key={beam.id} beam={beam} />
           ))}
         </AnimatePresence>

         {/* Nodes Area */}
         {agents.map(agent => (
           <AgentNode 
             key={agent.id} 
             agent={agent} 
             isSelected={activeContactId === agent.id}
             onClick={() => setActiveContactId(agent.id)}
           />
         ))}
      </div>

    </div>
  );
}