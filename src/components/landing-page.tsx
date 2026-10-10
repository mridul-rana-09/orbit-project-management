"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowRight, Bell, CalendarDays, Check, CheckCheck, ChevronRight, FolderKanban, LayoutDashboard, ListTodo, Menu, Moon, Sun, Users, X } from "lucide-react";
import "./landing-page.css";

const features = [
  { icon: FolderKanban, title: "Project Management", text: "Keep project goals, ownership, and timelines organized in one workspace." },
  { icon: ListTodo, title: "Task Management", text: "Create clear tasks, set priorities, assign owners, and keep work moving." },
  { icon: CheckCheck, title: "Kanban Board", text: "See work at a glance and move tasks through your team's workflow." },
  { icon: Users, title: "Team Collaboration", text: "Bring workspace members and project teams together with clear roles." },
  { icon: CalendarDays, title: "Calendar & Deadlines", text: "Keep upcoming task due dates visible so important work stays on track." },
  { icon: Check, title: "Progress Tracking", text: "Understand project progress from task status and completion." },
  { icon: Bell, title: "Notifications", text: "Stay aware of task assignments and collaboration updates." },
  { icon: LayoutDashboard, title: "Productivity Analytics", text: "Review project and task activity in your workspace dashboard." },
];

const questions = [
  ["What is Orbit?", "Orbit is a project management tool for planning projects, managing tasks, collaborating with teams, and tracking deadlines."],
  ["What can I manage with Orbit?", "Organize workspaces, projects, tasks, task status and priority, team membership, comments, notifications, activity, and deadlines."],
  ["Can I create projects?", "Yes. Create projects in a workspace, set a description, status, color, and dates, and manage project members."],
  ["Can I assign tasks?", "Yes. Assign tasks to members of your workspace and set task status, priority, and a due date."],
  ["Can I manage team members?", "Workspace owners and admins can invite members and manage appropriate workspace and project roles."],
  ["Can I track deadlines?", "Yes. Task due dates appear in the calendar and upcoming-deadlines views."],
  ["Is Orbit responsive?", "Yes. Orbit's workspace experience adapts to desktop, tablet, and mobile screens."],
];

function AuthLinkError() {
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const error = fragment.get("error");
    if (error) {
      const receivedCode = fragment.get("error_code");
      const allowedCodes = ["access_denied", "otp_expired", "email_not_confirmed"];
      const code = receivedCode && allowedCodes.includes(receivedCode) ? receivedCode : "callback";
      window.location.replace(`/login?auth_error=${encodeURIComponent(code)}`);
    }
  }, []);

  return null;
}

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const isDark = localStorage.getItem("orbit-theme") === "dark";
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    localStorage.setItem("orbit-theme", next ? "dark" : "light");
    document.documentElement.classList.toggle("dark", next);
  }

  return <div className="landing-shell">
    <AuthLinkError />
    <header className="landing-nav">
      <Link className="landing-brand" href="/" aria-label="Orbit home"><span className="landing-brand-mark">◈</span><span>orbit</span></Link>
      <nav className={menuOpen ? "landing-nav-links open" : "landing-nav-links"} aria-label="Main navigation">
        <a href="#features" onClick={() => setMenuOpen(false)}>Features</a>
        <a href="#how-it-works" onClick={() => setMenuOpen(false)}>How It Works</a>
        <a href="#about" onClick={() => setMenuOpen(false)}>About</a>
        <a href="#faq" onClick={() => setMenuOpen(false)}>FAQ</a>
        <div className="landing-mobile-actions"><Link href="/login">Sign In</Link><Link className="landing-button primary" href="/signup">Get Started <ArrowRight size={16}/></Link></div>
      </nav>
      <div className="landing-nav-actions">
        <button className="landing-theme-toggle" type="button" onClick={toggleTheme} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>{dark ? <Sun size={17}/> : <Moon size={17}/>}</button>
        <Link className="landing-signin" href="/login">Sign In</Link>
        <Link className="landing-button primary nav-cta" href="/signup">Get Started <ArrowRight size={16}/></Link>
      </div>
      <button className="landing-menu-toggle" type="button" aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={21}/> : <Menu size={21}/>}</button>
    </header>

    <main>
      <section className="landing-hero">
        <div className="landing-hero-glow" aria-hidden="true"/>
        <div className="landing-hero-content">
          <span className="landing-eyebrow"><span className="landing-eyebrow-mark">◈</span> A clearer way to work together</span>
          <h1>Plan Projects.<br/><span>Manage Tasks.</span><br/>Deliver Better.</h1>
          <p>Organize projects, assign tasks, collaborate with your team, and stay on top of deadlines from one powerful workspace.</p>
          <div className="landing-hero-actions"><Link className="landing-button primary large" href="/signup">Get Started <ArrowRight size={17}/></Link><Link className="landing-button secondary large" href="/login">Sign In</Link></div>
          <div className="landing-hero-note"><Check size={15}/> Your work, organized in one place</div>
        </div>
        <div className="landing-preview-wrap">
          <DashboardPreview />
          <div className="landing-preview-caption"><span className="landing-live-dot"/> Workspace dashboard <span>Illustrative preview</span></div>
        </div>
        <a className="landing-scroll-cue" href="#features" aria-label="Scroll to features"><ArrowDown size={17}/></a>
      </section>

      <section className="landing-section landing-features" id="features">
        <div className="landing-section-heading"><span className="landing-kicker">Everything in orbit</span><h2>One workspace. <span>Clearer momentum.</span></h2><p>Bring the everyday parts of project work together, without adding unnecessary complexity.</p></div>
        <div className="landing-feature-grid">{features.map(({icon:Icon,title,text},index)=><article className="landing-feature-card" key={title}><span className={`landing-feature-icon tone-${index%4}`}><Icon size={20}/></span><h3>{title}</h3><p>{text}</p></article>)}</div>
      </section>

      <section className="landing-section landing-how" id="how-it-works">
        <div className="landing-section-heading"><span className="landing-kicker">A simple workflow</span><h2>From idea to <span>done.</span></h2><p>Start with a workspace and give your team a shared view of the work.</p></div>
        <div className="landing-steps">
          {[["01","Create your workspace","Set up a shared home for your team and its work."],["02","Create projects and tasks","Break goals into tasks, assign owners, and set priorities and due dates."],["03","Track progress and complete work","Move tasks through the board and keep deadlines and progress in view."]].map(([number,title,text],index)=><article className="landing-step" key={number}><span className="landing-step-number">{number}</span><div className="landing-step-connector" aria-hidden="true">{index<2&&<ChevronRight size={20}/>}</div><h3>{title}</h3><p>{text}</p></article>)}
        </div>
      </section>

      <section className="landing-section landing-about" id="about">
        <div className="landing-about-copy"><span className="landing-kicker">Built for focus</span><h2>Make progress visible.<br/><span>Make teamwork easier.</span></h2><p>Orbit brings plans, people, and deadlines into a shared workspace so teams can spend less time searching and more time delivering.</p><div className="landing-benefits">{["Centralized project management","Better task organization","Clear deadlines","Team visibility","Productivity tracking","Easy collaboration"].map(item=><span key={item}><Check size={15}/>{item}</span>)}</div><Link className="landing-text-link" href="/signup">Bring your work together <ArrowRight size={16}/></Link></div>
        <DashboardPreview compact />
      </section>

      <section className="landing-section landing-faq" id="faq">
        <div className="landing-section-heading"><span className="landing-kicker">Questions, answered</span><h2>Good to <span>know.</span></h2></div>
        <div className="landing-faq-list">{questions.map(([question,answer])=><details key={question}><summary>{question}<span>+</span></summary><p>{answer}</p></details>)}</div>
      </section>

      <section className="landing-final-cta"><div><span className="landing-kicker">Your next step starts here</span><h2>Ready to take control of your projects?</h2><p>Create a workspace and bring your team&apos;s work into focus.</p></div><Link className="landing-button light large" href="/signup">Get Started <ArrowRight size={17}/></Link></section>
    </main>

    <footer className="landing-footer">
      <div className="landing-footer-main"><div className="landing-footer-brand"><Link className="landing-brand" href="/"><span className="landing-brand-mark">◈</span><span>orbit</span></Link><p>Plan projects, manage tasks, and deliver better together.</p></div><div className="landing-footer-links"><div><b>Product</b><a href="#features">Features</a><a href="#how-it-works">How It Works</a></div><div><b>Explore</b><a href="#about">About</a><a href="#faq">FAQ</a></div><div><b>Get started</b><Link href="/login">Sign In</Link><Link href="/signup">Get Started</Link></div></div></div>
      <div className="landing-footer-bottom"><span>© {new Date().getFullYear()} Orbit. All rights reserved.</span><a href="mailto:hello@orbitapp.example">Contact</a></div>
    </footer>
  </div>;
}

function DashboardPreview({compact=false}:{compact?:boolean}) {
  return <div className={`dashboard-preview${compact?" compact":""}`} aria-label="Illustrative Orbit dashboard preview">
    <div className="preview-sidebar"><div className="preview-brand"><span>◈</span> orbit</div><div className="preview-workspace"><i/> My workspace <span>⌄</span></div><small>WORKSPACE</small><div className="preview-nav active"><LayoutDashboard size={14}/> Overview</div><div className="preview-nav"><ListTodo size={14}/> My tasks</div><div className="preview-nav"><FolderKanban size={14}/> Projects</div><div className="preview-nav"><CheckCheck size={14}/> Board</div><div className="preview-nav"><CalendarDays size={14}/> Calendar</div><div className="preview-nav"><Users size={14}/> Team</div></div>
    <div className="preview-main"><div className="preview-topbar"><span>Workspace　›　Overview</span><div><i/><i/><b>OR</b></div></div><div className="preview-content"><div className="preview-greeting"><div><small>WORKSPACE OVERVIEW</small><h3>Good morning, team</h3><p>Here&apos;s what&apos;s happening with your projects.</p></div><span>＋ New task</span></div><div className="preview-stat-row"><div><small>Active projects</small><b><i/></b><span>Across your workspace</span></div><div><small>Tasks in progress</small><b><i/></b><span>Current team workload</span></div><div><small>Upcoming deadlines</small><b><i/></b><span>Keep work on schedule</span></div></div><div className="preview-board"><div className="preview-board-head"><b>Task board</b><span>Current workflow</span></div><div className="preview-columns">{[["TO DO","Define project goals","Review requirements"],["IN PROGRESS","Prepare the first draft"],["IN REVIEW","Share team feedback"]].map(([title,...cards])=><div className="preview-column" key={title}><small><i/> {title}</small>{cards.map(card=><div className="preview-task" key={card}><b>{card}</b><span><i/> <i/> <i/></span></div>)}</div>)}</div></div></div></div>
  </div>;
}
