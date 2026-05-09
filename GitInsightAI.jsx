import { useState, useEffect, useRef, useCallback } from "react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, PieChart, Pie, Cell, Legend,
  AreaChart, Area
} from "recharts";

// ─── Theme ───────────────────────────────────────────────────────────────────
const C = {
  bg: "#050510",
  bgCard: "rgba(255,255,255,0.03)",
  bgCardHover: "rgba(255,255,255,0.06)",
  border: "rgba(0,217,255,0.15)",
  borderBright: "rgba(0,217,255,0.4)",
  cyan: "#00d9ff",
  violet: "#7c3aed",
  green: "#39ff14",
  magenta: "#ff006e",
  amber: "#ff9500",
  text: "#e2e8f0",
  muted: "#64748b",
  white: "#ffffff",
};

const glass = {
  background: C.bgCard,
  border: `1px solid ${C.border}`,
  borderRadius: "16px",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
};

const glassHover = { ...glass, background: C.bgCardHover, border: `1px solid ${C.borderBright}` };

const LANG_COLORS = {
  JavaScript: "#f1e05a", TypeScript: "#3178c6", Python: "#3572A5",
  Java: "#b07219", "C++": "#f34b7d", Go: "#00ADD8", Rust: "#dea584",
  Ruby: "#701516", CSS: "#563d7c", HTML: "#e34c26", Shell: "#89e051",
  Swift: "#F05138", Kotlin: "#A97BFF", Vue: "#41b883", Dart: "#00B4AB",
  PHP: "#4F5D95", "C#": "#178600", Scala: "#c22d40", default: "#8892b0",
};

const PERSONALITY_TYPES = {
  "Architect": { icon: "🏗️", desc: "You design scalable systems with precision", color: C.cyan },
  "Hacker": { icon: "⚡", desc: "Speed and innovation define your style", color: C.green },
  "Craftsman": { icon: "🔨", desc: "Quality and clean code are your hallmarks", color: C.amber },
  "Explorer": { icon: "🚀", desc: "Diverse tech stack, always learning", color: C.violet },
  "Collaborator": { icon: "🤝", desc: "Open-source champion and team player", color: C.magenta },
};

// ─── GitHub API ───────────────────────────────────────────────────────────────
async function fetchGitHub(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: "application/vnd.github.v3+json" }
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return res.json();
}

async function gatherProfile(username) {
  const [user, repos, events] = await Promise.all([
    fetchGitHub(`/users/${username}`),
    fetchGitHub(`/users/${username}/repos?per_page=100&sort=updated`),
    fetchGitHub(`/users/${username}/events/public?per_page=100`),
  ]);

  const langMap = {};
  const langBytes = {};
  for (const repo of repos) {
    if (repo.language) {
      langMap[repo.language] = (langMap[repo.language] || 0) + 1;
      langBytes[repo.language] = (langBytes[repo.language] || 0) + (repo.size || 0);
    }
  }

  const totalStars = repos.reduce((s, r) => s + r.stargazers_count, 0);
  const totalForks = repos.reduce((s, r) => s + r.forks_count, 0);
  const totalWatchers = repos.reduce((s, r) => s + r.watchers_count, 0);

  const commitDays = {};
  const commitHours = Array(24).fill(0);
  for (const ev of events) {
    if (ev.type === "PushEvent") {
      const d = new Date(ev.created_at);
      const key = ev.created_at.split("T")[0];
      commitDays[key] = (commitDays[key] || 0) + (ev.payload.commits?.length || 1);
      commitHours[d.getHours()] += 1;
    }
  }

  const topRepos = repos
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, 8)
    .map(r => ({ name: r.name.slice(0, 20), stars: r.stargazers_count, forks: r.forks_count, lang: r.language }));

  const topLangs = Object.entries(langMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count, bytes: langBytes[name] || 0 }));

  const recentActivity = Object.entries(commitDays)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-30)
    .map(([date, count]) => ({ date: date.slice(5), count }));

  const avgStars = repos.length ? (totalStars / repos.length).toFixed(1) : 0;
  const hasReadmeRepos = repos.filter(r => r.description).length;
  const readmeScore = repos.length ? Math.round((hasReadmeRepos / repos.length) * 100) : 0;
  const openSourceContribs = events.filter(e => e.type === "PullRequestEvent").length;
  const consistency = Object.keys(commitDays).length;

  return {
    user, repos, topRepos, topLangs, totalStars, totalForks, totalWatchers,
    commitDays, commitHours, recentActivity, avgStars, readmeScore,
    openSourceContribs, consistency, langMap,
    eventTypes: countEventTypes(events),
  };
}

function countEventTypes(events) {
  const m = {};
  for (const e of events) m[e.type] = (m[e.type] || 0) + 1;
  return Object.entries(m).map(([name, value]) => ({ name: name.replace("Event", ""), value }));
}

// ─── Anthropic API ────────────────────────────────────────────────────────────
async function callClaude(prompt, systemPrompt = "") {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt || "You are GitInsight AI, an expert developer career analyst. Be concise, insightful, and use emojis sparingly.",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || "Analysis unavailable.";
}

async function generateAIInsights(profile) {
  const { user, topLangs, totalStars, repos, openSourceContribs, consistency, readmeScore } = profile;
  const langList = topLangs.map(l => l.name).join(", ");

  const prompt = `Analyze this GitHub developer profile and return ONLY valid JSON (no markdown, no backticks):
Username: ${user.login}
Bio: ${user.bio || "Not provided"}
Followers: ${user.followers}, Following: ${user.following}
Public Repos: ${user.public_repos}
Top Languages: ${langList}
Total Stars: ${totalStars}
Open Source Contributions: ${openSourceContribs}
Commit Consistency (days active in last 100 events): ${consistency}
README Quality Score: ${readmeScore}%
Account Age: created ${user.created_at?.split("T")[0]}

Return this JSON structure:
{
  "personalityType": "one of: Architect, Hacker, Craftsman, Explorer, Collaborator",
  "personalityReason": "2 sentence explanation",
  "placementScore": number 0-100,
  "placementReason": "2 sentences",
  "hackathonScore": number 0-100,
  "hackathonReason": "2 sentences",
  "innovationScore": number 0-100,
  "collaborationScore": number 0-100,
  "projectComplexity": number 0-100,
  "growthTrend": "Ascending/Stable/Emerging",
  "topStrengths": ["strength1","strength2","strength3"],
  "skillGaps": ["gap1","gap2","gap3"],
  "certificationRecs": ["cert1","cert2","cert3"],
  "portfolioSummary": "3-4 sentence professional portfolio summary",
  "linkedinHeadline": "compelling LinkedIn headline under 15 words",
  "openSourceRecs": ["project1","project2","project3"],
  "roadmap": ["step1","step2","step3","step4"],
  "radarData": {
    "problemSolving": number 0-100,
    "codeQuality": number 0-100,
    "collaboration": number 0-100,
    "innovation": number 0-100,
    "consistency": number 0-100,
    "breadth": number 0-100
  }
}`;

  const raw = await callClaude(prompt);
  try {
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

// ─── Styled Components ────────────────────────────────────────────────────────
function GlowText({ children, color = C.cyan, size = 24, mono = false }) {
  return (
    <span style={{
      color, fontSize: size, fontWeight: 700,
      fontFamily: mono ? "monospace" : "inherit",
      textShadow: `0 0 20px ${color}60, 0 0 40px ${color}30`,
    }}>{children}</span>
  );
}

function StatCard({ label, value, icon, color = C.cyan, sub }) {
  return (
    <div style={{ ...glass, padding: "20px", textAlign: "center", flex: 1, minWidth: 120 }}>
      <div style={{ fontSize: 28, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color, fontFamily: "monospace",
        textShadow: `0 0 15px ${color}50` }}>{value}</div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color, marginTop: 2, opacity: 0.8 }}>{sub}</div>}
    </div>
  );
}

function SectionTitle({ children, accent = C.cyan }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
      <div style={{ width: 4, height: 24, background: accent, borderRadius: 2,
        boxShadow: `0 0 10px ${accent}` }} />
      <h2 style={{ color: C.text, fontSize: 18, fontWeight: 700, margin: 0 }}>{children}</h2>
    </div>
  );
}

function ScoreRing({ score, label, color = C.cyan, size = 120 }) {
  const r = (size - 16) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <svg width={size} height={size} style={{ filter: `drop-shadow(0 0 8px ${color}50)` }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={8} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`} />
        <text x={size/2} y={size/2+6} textAnchor="middle" fill={color}
          fontSize={size > 100 ? 22 : 16} fontWeight={800} fontFamily="monospace">{score}</text>
      </svg>
      <span style={{ fontSize: 12, color: C.muted, textAlign: "center", maxWidth: size }}>{label}</span>
    </div>
  );
}

function Badge({ children, color = C.cyan }) {
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px", borderRadius: 20,
      background: `${color}20`, border: `1px solid ${color}50`,
      color, fontSize: 11, fontWeight: 600,
    }}>{children}</span>
  );
}

function LoadingPulse({ text = "Analyzing..." }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, padding: 40 }}>
      <div style={{ position: "relative", width: 80, height: 80 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            position: "absolute", inset: i * 10, borderRadius: "50%",
            border: `2px solid ${C.cyan}`,
            opacity: 0.6 - i * 0.15,
            animation: `pulse ${1.2 + i * 0.3}s ease-in-out infinite alternate`,
          }} />
        ))}
        <style>{`@keyframes pulse{from{transform:scale(0.9);opacity:0.4}to{transform:scale(1.05);opacity:1}}`}</style>
      </div>
      <GlowText size={14}>{text}</GlowText>
    </div>
  );
}

// ─── Heatmap Calendar ─────────────────────────────────────────────────────────
function ContributionHeatmap({ commitDays }) {
  const weeks = [];
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 364);

  const maxCount = Math.max(1, ...Object.values(commitDays));

  for (let w = 0; w < 53; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(start.getDate() + w * 7 + d);
      const key = date.toISOString().split("T")[0];
      const count = commitDays[key] || 0;
      week.push({ date: key, count });
    }
    weeks.push(week);
  }

  const getColor = (count) => {
    if (!count) return "rgba(255,255,255,0.05)";
    const intensity = count / maxCount;
    if (intensity < 0.25) return `${C.cyan}40`;
    if (intensity < 0.5) return `${C.cyan}70`;
    if (intensity < 0.75) return `${C.cyan}aa`;
    return C.cyan;
  };

  return (
    <div style={{ overflowX: "auto", paddingBottom: 8 }}>
      <div style={{ display: "flex", gap: 3 }}>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {week.map((day, di) => (
              <div key={di} title={`${day.date}: ${day.count} commits`}
                style={{
                  width: 11, height: 11, borderRadius: 2,
                  background: getColor(day.count),
                  cursor: "default",
                  transition: "transform 0.1s",
                }}
                onMouseEnter={e => e.target.style.transform = "scale(1.5)"}
                onMouseLeave={e => e.target.style.transform = "scale(1)"}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Battle Mode ──────────────────────────────────────────────────────────────
function BattleMode({ primaryProfile }) {
  const [rival, setRival] = useState("");
  const [rivalProfile, setRivalProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [winner, setWinner] = useState(null);

  const fetchRival = async () => {
    if (!rival.trim()) return;
    setLoading(true); setError(""); setRivalProfile(null); setWinner(null);
    try {
      const p = await gatherProfile(rival.trim());
      setRivalProfile(p);
      // Compute winner
      const p1Score = scoreUser(primaryProfile);
      const p2Score = scoreUser(p);
      setWinner(p1Score >= p2Score ? primaryProfile.user.login : p.user.login);
    } catch {
      setError("Could not load rival profile.");
    } finally {
      setLoading(false);
    }
  };

  const scoreUser = (p) => {
    return p.totalStars * 3 + p.repos.length * 2 + p.user.followers * 1.5
      + p.openSourceContribs * 5 + p.consistency * 2 + p.totalForks;
  };

  const metrics = (p) => [
    { label: "Stars", value: p.totalStars },
    { label: "Repos", value: p.repos.length },
    { label: "Followers", value: p.user.followers },
    { label: "Forks", value: p.totalForks },
    { label: "Contributions", value: p.openSourceContribs },
    { label: "Active Days", value: p.consistency },
  ];

  return (
    <div>
      <SectionTitle accent={C.magenta}>⚔️ GitHub Battle Mode</SectionTitle>
      <div style={{ ...glass, padding: 24, marginBottom: 24 }}>
        <p style={{ color: C.muted, marginBottom: 16 }}>
          Challenge another developer and see who reigns supreme 🔥
        </p>
        <div style={{ display: "flex", gap: 12 }}>
          <input
            value={rival} onChange={e => setRival(e.target.value)}
            onKeyDown={e => e.key === "Enter" && fetchRival()}
            placeholder="Enter rival GitHub username..."
            style={{
              flex: 1, padding: "12px 16px", borderRadius: 10,
              background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border}`,
              color: C.text, fontSize: 14, outline: "none",
            }}
          />
          <button onClick={fetchRival}
            style={{
              padding: "12px 24px", borderRadius: 10, border: `1px solid ${C.magenta}`,
              background: `${C.magenta}20`, color: C.magenta, fontSize: 14,
              cursor: "pointer", fontWeight: 700,
            }}>BATTLE</button>
        </div>
        {error && <p style={{ color: C.magenta, marginTop: 8, fontSize: 13 }}>{error}</p>}
      </div>

      {loading && <LoadingPulse text="Loading rival profile..." />}

      {rivalProfile && (
        <div>
          {winner && (
            <div style={{
              textAlign: "center", padding: "16px", marginBottom: 24,
              ...glass, border: `1px solid ${C.amber}`,
            }}>
              <div style={{ fontSize: 32 }}>🏆</div>
              <GlowText color={C.amber} size={20}>Winner: @{winner}</GlowText>
              <p style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
                Based on stars, repos, followers, forks, and contribution activity
              </p>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 16, alignItems: "center" }}>
            {/* Player 1 */}
            <div style={{ ...glass, padding: 24, textAlign: "center",
              border: winner === primaryProfile.user.login ? `1px solid ${C.green}` : `1px solid ${C.border}` }}>
              <img src={primaryProfile.user.avatar_url} alt="" style={{ width: 80, height: 80, borderRadius: "50%", border: `2px solid ${C.cyan}` }} />
              <div style={{ color: C.cyan, fontWeight: 700, fontSize: 16, marginTop: 8 }}>@{primaryProfile.user.login}</div>
              <div style={{ color: C.muted, fontSize: 12, marginBottom: 16 }}>YOU</div>
              {metrics(primaryProfile).map((m, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0",
                  borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
                  <span style={{ color: C.muted }}>{m.label}</span>
                  <span style={{ color: C.text, fontWeight: 600, fontFamily: "monospace" }}>{m.value}</span>
                </div>
              ))}
            </div>

            <div style={{ textAlign: "center" }}>
              <GlowText color={C.magenta} size={28}>VS</GlowText>
            </div>

            {/* Rival */}
            <div style={{ ...glass, padding: 24, textAlign: "center",
              border: winner === rivalProfile.user.login ? `1px solid ${C.green}` : `1px solid ${C.border}` }}>
              <img src={rivalProfile.user.avatar_url} alt="" style={{ width: 80, height: 80, borderRadius: "50%", border: `2px solid ${C.magenta}` }} />
              <div style={{ color: C.magenta, fontWeight: 700, fontSize: 16, marginTop: 8 }}>@{rivalProfile.user.login}</div>
              <div style={{ color: C.muted, fontSize: 12, marginBottom: 16 }}>RIVAL</div>
              {metrics(rivalProfile).map((m, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0",
                  borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
                  <span style={{ color: C.muted }}>{m.label}</span>
                  <span style={{ color: C.text, fontWeight: 600, fontFamily: "monospace" }}>{m.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Comparison bar chart */}
          <div style={{ ...glass, padding: 24, marginTop: 24 }}>
            <SectionTitle>Score Comparison</SectionTitle>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={metrics(primaryProfile).map((m, i) => ({
                label: m.label,
                [primaryProfile.user.login]: m.value,
                [rivalProfile.user.login]: metrics(rivalProfile)[i].value,
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 11 }} />
                <YAxis tick={{ fill: C.muted, fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#0d1117", border: `1px solid ${C.border}` }} />
                <Bar dataKey={primaryProfile.user.login} fill={C.cyan} radius={[4,4,0,0]} />
                <Bar dataKey={rivalProfile.user.login} fill={C.magenta} radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Career Chatbot ───────────────────────────────────────────────────────────
function CareerChatbot({ profile, insights }) {
  const [messages, setMessages] = useState([
    { role: "assistant", content: `Hi! I'm your AI Career Mentor 🤖 I've analyzed @${profile.user.login}'s GitHub profile. Ask me anything — skill gaps, career paths, project ideas, certifications, or how to level up! What's on your mind?` }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);

    const context = `Developer context:
- Username: ${profile.user.login}
- Languages: ${profile.topLangs.map(l=>l.name).join(", ")}
- Stars: ${profile.totalStars}, Repos: ${profile.repos.length}, Followers: ${profile.user.followers}
- Personality: ${insights?.personalityType}
- Placement Score: ${insights?.placementScore}/100
- Skill Gaps: ${insights?.skillGaps?.join(", ")}
- Strengths: ${insights?.topStrengths?.join(", ")}`;

    const systemPrompt = `You are GitInsight AI Career Mentor, an expert software engineering career advisor. 
${context}
Be encouraging, specific, actionable. Use bullet points. Keep responses under 200 words. Use emojis sparingly.`;

    const reply = await callClaude(userMsg, systemPrompt);
    setMessages(prev => [...prev, { role: "assistant", content: reply }]);
    setLoading(false);
  };

  const suggestions = [
    "What skills should I learn next?",
    "How do I improve my placement score?",
    "Suggest open source projects for me",
    "What certifications would help me?",
    "Generate my career roadmap",
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: 600 }}>
      <SectionTitle accent={C.violet}>🤖 AI Career Mentor</SectionTitle>

      {/* Suggestions */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {suggestions.map((s, i) => (
          <button key={i} onClick={() => { setInput(s); }}
            style={{
              padding: "6px 12px", borderRadius: 20, fontSize: 12, cursor: "pointer",
              background: `${C.violet}20`, border: `1px solid ${C.violet}50`, color: C.violet,
            }}>{s}</button>
        ))}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", ...glass, padding: 20, marginBottom: 16, display: "flex", flexDirection: "column", gap: 16 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              maxWidth: "80%", padding: "12px 16px", borderRadius: 12, fontSize: 14, lineHeight: 1.6,
              background: m.role === "user" ? `${C.cyan}20` : `${C.violet}15`,
              border: `1px solid ${m.role === "user" ? C.cyan : C.violet}40`,
              color: C.text, whiteSpace: "pre-wrap",
            }}>
              {m.role === "assistant" && <span style={{ color: C.violet, fontWeight: 700, fontSize: 12, display: "block", marginBottom: 4 }}>GitInsight AI ✨</span>}
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: "flex", gap: 6, padding: "12px 16px" }}>
            {[0,1,2].map(i => <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: C.violet, animation: `bounce ${0.6+i*0.2}s ease infinite alternate` }} />)}
            <style>{`@keyframes bounce{from{transform:translateY(0)}to{transform:translateY(-8px)}}`}</style>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div style={{ display: "flex", gap: 12 }}>
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder="Ask your AI career mentor..."
          style={{
            flex: 1, padding: "14px 18px", borderRadius: 12, fontSize: 14,
            background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border}`,
            color: C.text, outline: "none",
          }}
        />
        <button onClick={send} disabled={loading}
          style={{
            padding: "14px 24px", borderRadius: 12, fontSize: 14, cursor: "pointer",
            background: `${C.violet}30`, border: `1px solid ${C.violet}`,
            color: C.violet, fontWeight: 700,
          }}>SEND ↑</button>
      </div>
    </div>
  );
}

// ─── AI Insights Panel ────────────────────────────────────────────────────────
function AIInsightsPanel({ insights, profile }) {
  if (!insights) return <LoadingPulse text="Generating AI insights..." />;

  const pt = PERSONALITY_TYPES[insights.personalityType] || PERSONALITY_TYPES["Explorer"];
  const radarData = insights.radarData ? Object.entries(insights.radarData).map(([key, val]) => ({
    subject: key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase()),
    value: val, fullMark: 100,
  })) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Personality Type */}
      <div style={{ ...glass, padding: 24, border: `1px solid ${pt.color}40` }}>
        <SectionTitle accent={pt.color}>🧠 Developer Personality</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ fontSize: 64 }}>{pt.icon}</div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800, color: pt.color,
              textShadow: `0 0 20px ${pt.color}50` }}>{insights.personalityType}</div>
            <div style={{ color: C.muted, fontSize: 14, marginTop: 4 }}>{pt.desc}</div>
            <p style={{ color: C.text, fontSize: 14, marginTop: 12, lineHeight: 1.6 }}>{insights.personalityReason}</p>
          </div>
        </div>
      </div>

      {/* Score Cards */}
      <div>
        <SectionTitle>📊 Developer Scores</SectionTitle>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 24, justifyContent: "center" }}>
          <ScoreRing score={insights.placementScore} label="Placement Readiness" color={C.cyan} />
          <ScoreRing score={insights.hackathonScore} label="Hackathon Predictor" color={C.green} />
          <ScoreRing score={insights.innovationScore} label="Innovation Score" color={C.amber} />
          <ScoreRing score={insights.collaborationScore} label="Collaboration" color={C.violet} />
          <ScoreRing score={insights.projectComplexity} label="Project Complexity" color={C.magenta} />
        </div>
      </div>

      {/* Radar */}
      {radarData.length > 0 && (
        <div style={{ ...glass, padding: 24 }}>
          <SectionTitle>🕸️ Skill Radar</SectionTitle>
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="rgba(255,255,255,0.1)" />
              <PolarAngleAxis dataKey="subject" tick={{ fill: C.muted, fontSize: 12 }} />
              <PolarRadiusAxis tick={{ fill: C.muted, fontSize: 10 }} domain={[0, 100]} />
              <Radar name="Skills" dataKey="value" stroke={C.cyan} fill={C.cyan} fillOpacity={0.2} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 3-column grid: Strengths, Gaps, Certs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        {[
          { title: "💪 Top Strengths", items: insights.topStrengths, color: C.green },
          { title: "🎯 Skill Gaps", items: insights.skillGaps, color: C.magenta },
          { title: "📜 Certifications", items: insights.certificationRecs, color: C.amber },
        ].map(({ title, items, color }) => (
          <div key={title} style={{ ...glass, padding: 20, border: `1px solid ${color}30` }}>
            <div style={{ color, fontWeight: 700, marginBottom: 12, fontSize: 14 }}>{title}</div>
            {(items || []).map((item, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8,
                padding: "6px 0", borderBottom: `1px solid rgba(255,255,255,0.05)`, fontSize: 13, color: C.text }}>
                <span style={{ color, flexShrink: 0 }}>›</span> {item}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Portfolio Summary + LinkedIn */}
      <div style={{ ...glass, padding: 24 }}>
        <SectionTitle accent={C.cyan}>✨ AI Portfolio Summary</SectionTitle>
        <p style={{ color: C.text, lineHeight: 1.8, fontSize: 14, marginBottom: 20 }}>{insights.portfolioSummary}</p>
        <div style={{ ...glass, padding: 16, background: `${C.violet}10`, border: `1px solid ${C.violet}40` }}>
          <div style={{ fontSize: 12, color: C.violet, fontWeight: 700, marginBottom: 6 }}>🔗 LinkedIn Headline</div>
          <div style={{ color: C.text, fontSize: 16, fontWeight: 600 }}>{insights.linkedinHeadline}</div>
        </div>
      </div>

      {/* Roadmap */}
      <div style={{ ...glass, padding: 24 }}>
        <SectionTitle accent={C.amber}>🗺️ AI Growth Roadmap</SectionTitle>
        <div style={{ position: "relative", paddingLeft: 32 }}>
          <div style={{ position: "absolute", left: 10, top: 0, bottom: 0, width: 2,
            background: `linear-gradient(to bottom, ${C.amber}, transparent)` }} />
          {(insights.roadmap || []).map((step, i) => (
            <div key={i} style={{ position: "relative", marginBottom: 20 }}>
              <div style={{
                position: "absolute", left: -28, top: 2, width: 20, height: 20,
                borderRadius: "50%", background: C.amber, display: "flex",
                alignItems: "center", justifyContent: "center", fontSize: 11,
                fontWeight: 800, color: "#000",
              }}>{i + 1}</div>
              <div style={{ ...glass, padding: "12px 16px", fontSize: 14, color: C.text, lineHeight: 1.6,
                border: `1px solid ${C.amber}30` }}>{step}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Open Source Recs */}
      <div style={{ ...glass, padding: 24 }}>
        <SectionTitle accent={C.green}>🌐 Open Source Recommendations</SectionTitle>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {(insights.openSourceRecs || []).map((rec, i) => (
            <div key={i} style={{ ...glass, padding: "12px 18px", border: `1px solid ${C.green}40`,
              color: C.green, fontSize: 13, cursor: "default" }}>
              ⭐ {rec}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab({ profile }) {
  const { user, topLangs, topRepos, totalStars, totalForks, recentActivity,
    commitHours, totalWatchers, readmeScore, openSourceContribs } = profile;

  const langData = topLangs.map(l => ({ name: l.name, value: l.count }));
  const langTotal = langData.reduce((s, l) => s + l.value, 0);

  const hourlyData = commitHours.map((count, h) => ({
    hour: `${h}:00`, count
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Hero Stats */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <StatCard label="Total Stars" value={totalStars.toLocaleString()} icon="⭐" color={C.amber} />
        <StatCard label="Public Repos" value={user.public_repos} icon="📁" color={C.cyan} />
        <StatCard label="Followers" value={user.followers.toLocaleString()} icon="👥" color={C.violet} />
        <StatCard label="Total Forks" value={totalForks.toLocaleString()} icon="🍴" color={C.green} />
        <StatCard label="Contributions" value={openSourceContribs} icon="🔥" color={C.magenta} sub="PR contributions" />
        <StatCard label="README Score" value={`${readmeScore}%`} icon="📝" color={C.cyan} sub="Documentation quality" />
      </div>

      {/* Contribution Heatmap */}
      <div style={{ ...glass, padding: 24 }}>
        <SectionTitle>📅 Contribution Activity (Last Year)</SectionTitle>
        <ContributionHeatmap commitDays={profile.commitDays} />
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginTop: 12 }}>
          <span style={{ fontSize: 11, color: C.muted }}>Less</span>
          {["rgba(255,255,255,0.05)", `${C.cyan}40`, `${C.cyan}70`, `${C.cyan}aa`, C.cyan].map((c, i) => (
            <div key={i} style={{ width: 11, height: 11, borderRadius: 2, background: c }} />
          ))}
          <span style={{ fontSize: 11, color: C.muted }}>More</span>
        </div>
      </div>

      {/* Languages + Top Repos */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 16 }}>
        <div style={{ ...glass, padding: 24 }}>
          <SectionTitle>💬 Languages</SectionTitle>
          <div style={{ marginBottom: 16 }}>
            {topLangs.map(l => (
              <div key={l.name} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 13, color: C.text }}>{l.name}</span>
                  <span style={{ fontSize: 12, color: C.muted }}>{Math.round(l.count / profile.repos.length * 100)}%</span>
                </div>
                <div style={{ height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 3 }}>
                  <div style={{
                    height: "100%", borderRadius: 3,
                    background: LANG_COLORS[l.name] || LANG_COLORS.default,
                    width: `${Math.round(l.count / topLangs[0].count * 100)}%`,
                    boxShadow: `0 0 8px ${LANG_COLORS[l.name] || LANG_COLORS.default}60`,
                  }} />
                </div>
              </div>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={langData} dataKey="value" nameKey="name" innerRadius={40} outerRadius={80}>
                {langData.map((l, i) => (
                  <Cell key={i} fill={LANG_COLORS[l.name] || LANG_COLORS.default} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: "#0d1117", border: `1px solid ${C.border}`, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div style={{ ...glass, padding: 24 }}>
          <SectionTitle>🏆 Top Repositories</SectionTitle>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={topRepos} layout="vertical" margin={{ left: 0, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
              <XAxis type="number" tick={{ fill: C.muted, fontSize: 10 }} />
              <YAxis type="category" dataKey="name" tick={{ fill: C.text, fontSize: 11 }} width={120} />
              <Tooltip contentStyle={{ background: "#0d1117", border: `1px solid ${C.border}` }} />
              <Bar dataKey="stars" fill={C.amber} radius={[0,4,4,0]} name="⭐ Stars">
                {topRepos.map((_, i) => <Cell key={i} fill={`hsl(${40+i*15},100%,60%)`} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Activity Timeline */}
      <div style={{ ...glass, padding: 24 }}>
        <SectionTitle>📈 30-Day Commit Activity</SectionTitle>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={recentActivity}>
            <defs>
              <linearGradient id="cGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={C.cyan} stopOpacity={0.3} />
                <stop offset="95%" stopColor={C.cyan} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="date" tick={{ fill: C.muted, fontSize: 10 }} />
            <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
            <Tooltip contentStyle={{ background: "#0d1117", border: `1px solid ${C.border}` }} />
            <Area type="monotone" dataKey="count" stroke={C.cyan} fill="url(#cGrad)" strokeWidth={2} name="Commits" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Hourly Activity */}
      <div style={{ ...glass, padding: 24 }}>
        <SectionTitle accent={C.violet}>🕐 Coding Hours (When do you code?)</SectionTitle>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={hourlyData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis dataKey="hour" tick={{ fill: C.muted, fontSize: 9 }} interval={2} />
            <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
            <Tooltip contentStyle={{ background: "#0d1117", border: `1px solid ${C.border}` }} />
            <Bar dataKey="count" fill={C.violet} radius={[4,4,0,0]} name="Events">
              {hourlyData.map((d, i) => <Cell key={i} fill={`hsl(${260+d.count*20},70%,60%)`} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Landing Page ─────────────────────────────────────────────────────────────
function Landing({ onSearch }) {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSearch = async () => {
    if (!username.trim()) return;
    setLoading(true); setError("");
    try {
      const profile = await gatherProfile(username.trim());
      onSearch(profile);
    } catch (e) {
      setError(e.message.includes("404") ? "GitHub user not found." : "Failed to fetch profile. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const demos = ["torvalds", "gaearon", "sindresorhus", "yyx990803", "addyosmani"];

  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: 24, position: "relative",
    }}>
      {/* Background grid */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0,
        backgroundImage: `linear-gradient(rgba(0,217,255,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,217,255,0.03) 1px, transparent 1px)`,
        backgroundSize: "40px 40px",
      }} />

      {/* Glow orbs */}
      {[["-20%","20%",C.cyan], ["80%","60%",C.violet], ["30%","80%",C.magenta]].map(([x,y,c],i) => (
        <div key={i} style={{
          position: "fixed", left: x, top: y, width: 400, height: 400,
          borderRadius: "50%", background: c, filter: "blur(120px)", opacity: 0.06, zIndex: 0,
        }} />
      ))}

      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 640, textAlign: "center" }}>
        {/* Logo */}
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 12, letterSpacing: 6, color: C.cyan, fontFamily: "monospace", opacity: 0.7 }}>
            AI-POWERED
          </span>
        </div>
        <h1 style={{
          fontSize: 56, fontWeight: 900, margin: "0 0 8px",
          background: `linear-gradient(135deg, ${C.white}, ${C.cyan}, ${C.violet})`,
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          lineHeight: 1.1,
        }}>GitInsight AI</h1>
        <p style={{ color: C.muted, fontSize: 16, marginBottom: 48, lineHeight: 1.6 }}>
          Analyze GitHub profiles with AI • Developer Personality • Career Insights • Battle Mode
        </p>

        {/* Search */}
        <div style={{ position: "relative", marginBottom: 16 }}>
          <div style={{
            display: "flex", gap: 0, ...glass,
            border: `1px solid ${C.border}`, overflow: "hidden", padding: 0,
          }}>
            <span style={{ padding: "16px 20px", color: C.cyan, fontSize: 18 }}>@</span>
            <input
              value={username} onChange={e => setUsername(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              placeholder="Enter GitHub username..."
              style={{
                flex: 1, padding: "16px 0", background: "none", border: "none",
                color: C.text, fontSize: 16, outline: "none",
              }}
            />
            <button onClick={handleSearch} disabled={loading}
              style={{
                padding: "16px 32px", background: `${C.cyan}20`, border: "none",
                borderLeft: `1px solid ${C.border}`, color: C.cyan,
                fontSize: 14, fontWeight: 700, cursor: "pointer",
                transition: "background 0.2s",
              }}>
              {loading ? "..." : "ANALYZE →"}
            </button>
          </div>
          {error && <p style={{ color: C.magenta, fontSize: 13, marginTop: 8 }}>{error}</p>}
        </div>

        {/* Demo users */}
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <span style={{ color: C.muted, fontSize: 12 }}>Try:</span>
          {demos.map(d => (
            <button key={d} onClick={() => { setUsername(d); }}
              style={{
                padding: "4px 12px", borderRadius: 20, fontSize: 12, cursor: "pointer",
                background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border}`,
                color: C.muted,
              }}>@{d}</button>
          ))}
        </div>

        {/* Features */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 48 }}>
          {[
            ["🧠", "AI Personality", "Discover your developer archetype"],
            ["📊", "Placement Score", "Interview & job readiness analysis"],
            ["⚔️", "Battle Mode", "Compare two developers head-to-head"],
            ["🎯", "Skill Gaps", "Know exactly what to learn next"],
            ["🤖", "Career Mentor", "AI chatbot for career guidance"],
            ["🗺️", "Roadmap", "Personalized growth trajectory"],
          ].map(([icon, title, desc]) => (
            <div key={title} style={{ ...glass, padding: 16, textAlign: "left" }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>{icon}</div>
              <div style={{ color: C.text, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{title}</div>
              <div style={{ color: C.muted, fontSize: 11 }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
function Dashboard({ profile, onBack }) {
  const [tab, setTab] = useState("overview");
  const [insights, setInsights] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsFetched, setInsightsFetched] = useState(false);

  const fetchInsights = useCallback(async () => {
    if (insightsFetched) return;
    setInsightsLoading(true);
    setInsightsFetched(true);
    const data = await generateAIInsights(profile);
    setInsights(data);
    setInsightsLoading(false);
  }, [profile, insightsFetched]);

  useEffect(() => {
    if (tab === "ai" || tab === "chat") fetchInsights();
  }, [tab, fetchInsights]);

  const { user } = profile;

  const TABS = [
    { id: "overview", label: "📊 Overview" },
    { id: "ai", label: "🧠 AI Analysis" },
    { id: "battle", label: "⚔️ Battle Mode" },
    { id: "chat", label: "🤖 Career Mentor" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'SF Pro Display', system-ui, sans-serif" }}>
      {/* Background grid */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        backgroundImage: `linear-gradient(rgba(0,217,255,0.02) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,217,255,0.02) 1px, transparent 1px)`,
        backgroundSize: "40px 40px",
      }} />

      {/* Navbar */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 100,
        background: "rgba(5,5,16,0.85)", backdropFilter: "blur(20px)",
        borderBottom: `1px solid ${C.border}`, padding: "12px 24px",
        display: "flex", alignItems: "center", gap: 16,
      }}>
        <button onClick={onBack} style={{
          background: "none", border: `1px solid ${C.border}`, color: C.muted,
          padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12,
        }}>← Back</button>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
          <img src={user.avatar_url} alt="" style={{ width: 36, height: 36, borderRadius: "50%",
            border: `2px solid ${C.cyan}`, boxShadow: `0 0 10px ${C.cyan}50` }} />
          <div>
            <div style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>@{user.login}</div>
            <div style={{ color: C.muted, fontSize: 11 }}>{user.name || user.login}</div>
          </div>
          {user.bio && <div style={{ color: C.muted, fontSize: 12, borderLeft: `1px solid ${C.border}`,
            paddingLeft: 16, maxWidth: 300 }}>{user.bio}</div>}
        </div>

        <div style={{ display: "flex", gap: 4 }}>
          {[
            { icon: "🌍", value: user.location },
            { icon: "🏢", value: user.company },
            { icon: "🔗", value: user.blog ? "Website" : null },
          ].filter(i => i.value).map((item, i) => (
            <Badge key={i} color={C.muted}>{item.icon} {item.value}</Badge>
          ))}
        </div>

        <GlowText size={14} color={C.cyan}>GitInsight AI</GlowText>
      </nav>

      {/* Tab bar */}
      <div style={{
        position: "sticky", top: 61, zIndex: 99,
        background: "rgba(5,5,16,0.9)", backdropFilter: "blur(10px)",
        borderBottom: `1px solid ${C.border}`,
        display: "flex", padding: "0 24px",
      }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: "14px 20px", background: "none", border: "none",
              color: tab === t.id ? C.cyan : C.muted,
              fontSize: 13, fontWeight: tab === t.id ? 700 : 400,
              cursor: "pointer", position: "relative",
              borderBottom: tab === t.id ? `2px solid ${C.cyan}` : "2px solid transparent",
              marginBottom: -1, transition: "color 0.2s",
            }}>{t.label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 24px 60px", position: "relative", zIndex: 1 }}>
        {tab === "overview" && <OverviewTab profile={profile} />}
        {tab === "ai" && (
          insightsLoading
            ? <LoadingPulse text="Generating AI insights with Claude..." />
            : <AIInsightsPanel insights={insights} profile={profile} />
        )}
        {tab === "battle" && <BattleMode primaryProfile={profile} />}
        {tab === "chat" && (
          insightsLoading
            ? <LoadingPulse text="Preparing AI career mentor..." />
            : <CareerChatbot profile={profile} insights={insights} />
        )}
      </div>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [profile, setProfile] = useState(null);

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: rgba(255,255,255,0.02); }
        ::-webkit-scrollbar-thumb { background: rgba(0,217,255,0.3); border-radius: 3px; }
        input::placeholder { color: rgba(100,116,139,0.7); }
        button { font-family: inherit; }
      `}</style>

      {!profile
        ? <Landing onSearch={setProfile} />
        : <Dashboard profile={profile} onBack={() => setProfile(null)} />
      }
    </div>
  );
}
