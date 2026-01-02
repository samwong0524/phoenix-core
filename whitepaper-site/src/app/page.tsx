"use client";

import React from "react";
import { motion } from "framer-motion";
import { ArrowRight, Box, Users, MessageSquare, Zap, Layers } from "lucide-react";
import Link from "next/link";

const FeatureCard = ({ icon: Icon, title, description }: { icon: any, title: string, description: string }) => (
  <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800 hover:border-zinc-700 transition-colors">
    <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center mb-4 text-zinc-300">
      <Icon size={20} />
    </div>
    <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
    <p className="text-zinc-400 text-sm leading-relaxed">
      {description}
    </p>
  </div>
);

export default function Home() {
  return (
    <div className="min-h-screen bg-black text-zinc-200 font-sans selection:bg-white selection:text-black flex flex-col">
      
      {/* Navbar */}
      <nav className="border-b border-zinc-900/50 bg-black/50 backdrop-blur-xl fixed top-0 w-full z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-mono font-bold text-white tracking-tighter">
            <Box className="text-white" size={20} />
            MINIMAL_PRIMITIVE
          </div>
          <div className="flex gap-6 text-sm font-medium text-zinc-400">
            <Link href="/demo" className="hover:text-white transition-colors">Simulation</Link>
            <a href="#" className="hover:text-white transition-colors">Docs</a>
            <a href="#" className="hover:text-white transition-colors">GitHub</a>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col justify-center pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-400"
          >
            <span className="w-2 h-2 rounded-full bg-white"></span>
            The Social Agent Framework
          </motion.div>

          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-6xl md:text-8xl font-bold tracking-tight text-white leading-[0.9]"
          >
            Stop Orchestrating. <br />
            <span className="text-zinc-500">Start Organizing.</span>
          </motion.h1>

          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-xl text-zinc-400 max-w-2xl mx-auto leading-relaxed"
          >
            Building multi-agent systems shouldn't require complex graph theory. 
            Treat your agents like employees: hire them, message them, and let them work asynchronously.
          </motion.p>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4"
          >
            <Link href="/demo">
              <button className="h-12 px-8 rounded-full bg-white text-black font-bold hover:bg-zinc-200 transition-colors flex items-center gap-2">
                Run Simulation <ArrowRight size={18} />
              </button>
            </Link>
            <button className="h-12 px-8 rounded-full border border-zinc-800 text-zinc-300 font-medium hover:bg-zinc-900 transition-colors">
              Read the Whitepaper
            </button>
          </motion.div>
        </div>

        {/* 3 Primitives Grid */}
        <motion.div 
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.5 }}
          className="max-w-5xl mx-auto mt-32 grid md:grid-cols-3 gap-6"
        >
          <FeatureCard 
            icon={Users}
            title="Create"
            description="Define a role and an SOP. Not a node in a graph. Returns an ID you can reference anywhere."
          />
          <FeatureCard 
            icon={MessageSquare}
            title="Send"
            description="Asynchronous message passing. Decouples the sender from the receiver's state."
          />
          <FeatureCard 
            icon={Zap}
            title="Wake"
            description="Agents sleep by default. They only consume tokens when the Inbox reaches a threshold."
          />
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="py-8 border-t border-zinc-900 text-center text-zinc-600 text-sm">
        <p>Minimal Primitive © 2026</p>
      </footer>
    </div>
  );
}
