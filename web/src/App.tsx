import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { auth, firebaseEnabled } from "./firebase";

type View = "overview" | "patients" | "tracks" | "reports";
type Patient = {
  id: string;
  name: string;
  birthDate?: string | null;
  guardianName?: string | null;
  phoneme: string;
  track: string;
  guardianUid?: string;
  completedExercises: number;
  averageScore: number;
};
type Activity = {
  id: string;
  patientId: string;
  patientName: string;
  exerciseType: string;
  score: number;
  completedAt: string;
};
type Recording = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};
type ReportData = {
  summary: { completedThisWeek: number; completedLastWeek: number };
  dailyActivity: Array<{ date: string; count: number }>;
  patients: Array<{
    id: string;
    name: string;
    phoneme: string;
    track: string;
    exerciseCount: number;
    averageScore: number;
    recentExercises: number;
  }>;
  activities: Activity[];
};
type PatientInput = {
  name: string;
  birthDate: string;
  guardianName: string;
  phoneme: string;
  track: string;
  guardianUid?: string;
};

const trackCatalog = [
  { phoneme: "R", title: "O som do R", theme: "Vibrante simples", color: "coral", words: ["Arara", "Barata", "Careta", "Perigo"] },
  { phoneme: "S", title: "S de serpente", theme: "Sibilante", color: "mint", words: ["Sapo", "Sino", "Suco", "Assobio"] },
  { phoneme: "L", title: "Lá vem o L", theme: "Lateral", color: "lavender", words: ["Lua", "Bala", "Pelo", "Colher"] },
  { phoneme: "F", title: "F de foguete", theme: "Fricativa", color: "yellow", words: ["Fada", "Café", "Folha", "Fofoca"] },
];

const demoPatients: Patient[] = [
  { id: "demo-1", name: "Lara Mendes", birthDate: "2018-04-12", guardianName: "Marina Mendes", phoneme: "R", track: "O som do R", completedExercises: 18, averageScore: 87 },
  { id: "demo-2", name: "Theo Carvalho", birthDate: "2017-11-02", guardianName: "Rafael Carvalho", phoneme: "S", track: "S de serpente", completedExercises: 12, averageScore: 76 },
  { id: "demo-3", name: "Alice Nogueira", birthDate: "2019-02-23", guardianName: "Paula Nogueira", phoneme: "L", track: "Lá vem o L", completedExercises: 21, averageScore: 93 },
  { id: "demo-4", name: "Miguel Costa", birthDate: "2018-08-14", guardianName: "João Costa", phoneme: "F", track: "F de foguete", completedExercises: 9, averageScore: 68 },
];

const demoActivities: Activity[] = [
  { id: "a1", patientId: "demo-3", patientName: "Alice Nogueira", exerciseType: "Palavras com L", score: 96, completedAt: "2026-10-24T10:42:00" },
  { id: "a2", patientId: "demo-1", patientName: "Lara Mendes", exerciseType: "Rimas divertidas", score: 88, completedAt: "2026-10-24T09:18:00" },
  { id: "a3", patientId: "demo-2", patientName: "Theo Carvalho", exerciseType: "Som inicial S", score: 76, completedAt: "2026-10-23T16:25:00" },
  { id: "a4", patientId: "demo-4", patientName: "Miguel Costa", exerciseType: "Escuta e escolha", score: 70, completedAt: "2026-10-23T14:10:00" },
  { id: "a5", patientId: "demo-1", patientName: "Lara Mendes", exerciseType: "O R entre vogais", score: 91, completedAt: "2026-10-22T11:30:00" },
];

const navItems: Array<{ view: View; label: string; icon: string }> = [
  { view: "overview", label: "Visão geral", icon: "⌂" },
  { view: "patients", label: "Pacientes", icon: "♧" },
  { view: "tracks", label: "Trilhas", icon: "◉" },
  { view: "reports", label: "Evolução", icon: "↗" },
];

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(date));
}

function timeAgo(date: string) {
  const elapsed = Math.max(0, Date.now() - new Date(date).getTime());
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 1) return "Agora há pouco";
  if (hours < 24) return `Há ${hours}h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Ontem" : `Há ${days} dias`;
}

function useApi(user: User | null, demoMode: boolean) {
  return useCallback(async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    if (demoMode) throw new Error("A demonstração usa dados fictícios locais.");
    if (!user) throw new Error("Entre na sua conta para continuar.");
    const token = await user.getIdToken();
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
    const response = await fetch(`/api${path}`, { ...options, headers });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "Não foi possível concluir a solicitação." }));
      throw new Error(payload.error ?? "Não foi possível concluir a solicitação.");
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }, [demoMode, user]);
}

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  if (name === "search") return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>;
  if (name === "plus") return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
  if (name === "arrow") return <svg {...common}><path d="M5 12h14m-6-6 6 6-6 6" /></svg>;
  if (name === "calendar") return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>;
  if (name === "spark") return <svg {...common}><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" /></svg>;
  if (name === "wave") return <svg {...common}><path d="M2 12h2l3-8 4 16 4-16 3 8h4" /></svg>;
  if (name === "people") return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM20 8v6m3-3h-6" /></svg>;
  if (name === "close") return <svg {...common}><path d="m18 6-12 12M6 6l12 12" /></svg>;
  if (name === "upload") return <svg {...common}><path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4" /></svg>;
  return <svg {...common}><path d="M3 12h2l2-7 4 14 4-14 2 7h4" /></svg>;
}

function Avatar({ name, tone = "" }: { name: string; tone?: string }) {
  return <span className={`avatar ${tone}`} aria-label={name}>{initials(name)}</span>;
}

function Brand() {
  return <div className="brand">
    <span className="brand-mark"><i /><i /><i /><i /><i /></span>
    <span>fonoaudio<span className="brand-light">play</span></span>
  </div>;
}

function Login({ error, onLogin }: { error: string; onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    try { await onLogin(email, password); } finally { setLoading(false); }
  }
  return <main className="login-screen">
    <section className="login-card">
      <Brand />
      <span className="eyebrow">SEU ESPAÇO DE CUIDADO</span>
      <h1>O progresso acontece<br />um som de cada vez.</h1>
      <p>Acompanhe seus pacientes e leve a terapia para além do consultório.</p>
      <form onSubmit={submit} className="login-form">
        <label>E-mail profissional<input type="email" required autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@clinica.com.br" /></label>
        <label>Senha<input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Sua senha" /></label>
        {error && <div className="error-message">{error}</div>}
        <button className="button button-primary login-submit" disabled={loading}>{loading ? "Entrando..." : "Entrar na plataforma"}<Icon name="arrow" size={18} /></button>
      </form>
      <span className="login-footnote">Acesso protegido · Seus dados são privados</span>
    </section>
    <aside className="login-art">
      <div className="login-art-orb orb-one" /><div className="login-art-orb orb-two" />
      <div className="art-content"><span className="art-kicker">PEQUENAS CONQUISTAS, GRANDES DESCOBERTAS</span>
        <div className="sound-wave"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>
        <blockquote>“Cada tentativa é um passo mais perto de se fazer ouvir.”</blockquote>
        <div className="art-caption"><span className="caption-dot" />Um espaço feito para cada voz</div>
      </div>
    </aside>
  </main>;
}

function PatientModal({ patient, onClose, onTrackUpdate, request, demoMode, user, canManage, notify }: {
  patient: Patient;
  onClose: () => void;
  onTrackUpdate: (patient: Patient, track: typeof trackCatalog[number]) => Promise<void>;
  request: ReturnType<typeof useApi>;
  demoMode: boolean;
  user: User | null;
  canManage: boolean;
  notify: (message: string, error?: boolean) => void;
}) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [audioSources, setAudioSources] = useState<Record<string, string>>({});
  const [selectedTrack, setSelectedTrack] = useState(patient.track);
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [transcript, setTranscript] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (demoMode) return;
    request<Recording[]>(`/patients/${patient.id}/recordings`).then(setRecordings).catch((error: Error) => notify(error.message, true));
  }, [demoMode, notify, patient.id, request]);

  useEffect(() => {
    if (demoMode || !user || recordings.length === 0) return;
    const currentUser = user;
    let active = true;
    const urls: string[] = [];
    async function loadAudio() {
      const token = await currentUser.getIdToken();
      const sources = await Promise.all(recordings.map(async (recording) => {
        const response = await fetch(`/api/recordings/${recording.id}/audio`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error("Não foi possível carregar uma gravação.");
        const url = URL.createObjectURL(await response.blob());
        urls.push(url);
        return [recording.id, url] as const;
      }));
      if (active) setAudioSources(Object.fromEntries(sources));
    }
    loadAudio().catch((error: Error) => notify(error.message, true));
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [demoMode, notify, recordings, user]);

  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) {
      notify("O áudio deve ter até 12 MB.", true);
      return;
    }
    if (demoMode) {
      notify("No modo demonstração, os arquivos não são enviados nem armazenados.", true);
      return;
    }
    const body = new FormData();
    body.append("audio", file);
    setUploading(true);
    try {
      await request(`/patients/${patient.id}/recordings`, { method: "POST", body });
      setRecordings(await request<Recording[]>(`/patients/${patient.id}/recordings`));
      notify("Áudio enviado com segurança.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível enviar o áudio.", true);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function transcribe(recording: Recording) {
    try {
      const result = await request<{ text: string }>(`/recordings/${recording.id}/transcribe`, { method: "POST" });
      setTranscript(result.text);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível transcrever o áudio.", true);
    }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal patient-modal" role="dialog" aria-modal="true" aria-labelledby="patient-modal-title">
      <header className="modal-head"><div><span className="eyebrow">PERFIL DO PACIENTE</span><h2 id="patient-modal-title">{patient.name}</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><Icon name="close" /></button></header>
      <div className="patient-detail-grid">
        <div className="detail-highlight"><Avatar name={patient.name} /><div><strong>{patient.guardianName || "Responsável não informado"}</strong><span>Responsável</span></div><div className="detail-score"><strong>{patient.averageScore}%</strong><span>aproveitamento</span></div></div>
        {canManage && <div className="detail-section"><div className="section-title-row"><div><span className="eyebrow">TRILHA DA SEMANA</span><h3>Um som de cada vez</h3></div><span className="phoneme-badge">{patient.phoneme}</span></div>
          <label className="select-label">Trilha ativa<select value={selectedTrack} onChange={(event) => setSelectedTrack(event.target.value)}>{trackCatalog.map((track) => <option key={track.title}>{track.title}</option>)}</select></label>
          <button className="button button-secondary small-button" disabled={loadingTrack || selectedTrack === patient.track} onClick={async () => {
            const track = trackCatalog.find((item) => item.title === selectedTrack);
            if (!track) return;
            setLoadingTrack(true);
            try { await onTrackUpdate(patient, track); } finally { setLoadingTrack(false); }
          }}>{loadingTrack ? "Salvando..." : "Atualizar trilha"}</button>
        </div>}
        <div className="detail-section recording-section">
          <div className="section-title-row"><div><span className="eyebrow">ESCUTA COM CARINHO</span><h3>Gravações de áudio</h3></div><button className="button button-secondary small-button" disabled={uploading} onClick={() => fileInput.current?.click()}><Icon name="upload" size={16} />{uploading ? "Enviando..." : "Enviar áudio"}</button></div>
          <input ref={fileInput} className="visually-hidden" type="file" accept="audio/webm,audio/wav,audio/x-wav,audio/mpeg,audio/mp4,audio/aac" onChange={(event) => void upload(event.target.files?.[0])} />
          <p className="privacy-note">Áudios privados, acessíveis apenas às contas vinculadas. WAV, MP3, M4A ou WebM · até 12 MB.</p>
          {recordings.length === 0 ? <div className="empty-recordings">Nenhuma gravação disponível ainda.</div> : <div className="recording-list">{recordings.map((recording) => <div key={recording.id} className="recording-row"><div className="recording-icon"><Icon name="wave" size={17} /></div><div className="recording-info"><strong>{recording.originalName}</strong><span>{formatDate(recording.createdAt)} · {(recording.sizeBytes / 1024 / 1024).toFixed(1)} MB</span></div><audio controls preload="none" src={audioSources[recording.id]} />{canManage && <button className="text-button" onClick={() => void transcribe(recording)}>Transcrever</button>}</div>)}</div>}
          {transcript && <div className="transcript-box"><span className="eyebrow">TRANSCRIÇÃO · PORTUGUÊS</span><p>{transcript}</p></div>}
        </div>
      </div>
    </section>
  </div>;
}

function App() {
  const demoMode = !firebaseEnabled;
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(demoMode);
  const [loginError, setLoginError] = useState("");
  const [view, setView] = useState<View>("overview");
  const [patients, setPatients] = useState<Patient[]>(demoMode ? demoPatients : []);
  const [activities, setActivities] = useState<Activity[]>(demoMode ? demoActivities : []);
  const [search, setSearch] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const [loading, setLoading] = useState(!demoMode);
  const [loginEmail, setLoginEmail] = useState("");
  const [isTherapist, setIsTherapist] = useState(demoMode);
  const [weeklyTotal, setWeeklyTotal] = useState(demoMode ? 42 : 0);
  const [lastWeekTotal, setLastWeekTotal] = useState(demoMode ? 38 : 0);
  const [dailyCounts, setDailyCounts] = useState<number[]>(demoMode ? [5, 6, 4, 8, 6, 8, 5] : [0, 0, 0, 0, 0, 0, 0]);
  const [reportPatients, setReportPatients] = useState<ReportData["patients"]>(() => demoMode
    ? demoPatients.map((patient, index) => ({
      id: patient.id,
      name: patient.name,
      phoneme: patient.phoneme,
      track: patient.track,
      exerciseCount: patient.completedExercises,
      averageScore: patient.averageScore,
      recentExercises: [12, 9, 11, 10][index],
    }))
    : []);

  const request = useApi(user, demoMode);
  const notify = useCallback((message: string, error = false) => {
    setNotice({ message, error });
    window.setTimeout(() => setNotice(null), 3800);
  }, []);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
      setLoginEmail(currentUser?.email ?? "");
    });
  }, []);

  useEffect(() => {
    if (!user) {
      setIsTherapist(demoMode);
      return;
    }
    user.getIdTokenResult().then((token) => setIsTherapist(token.claims.role === "therapist"))
      .catch(() => notify("Não foi possível verificar as permissões da sua conta.", true));
  }, [demoMode, notify, user]);

  useEffect(() => {
    if (demoMode || !authReady || !user) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([request<Patient[]>("/patients"), request<ReportData>("/reports")])
      .then(([patientList, report]) => {
        if (cancelled) return;
        setPatients(patientList);
        setActivities(report.activities);
        setWeeklyTotal(report.summary.completedThisWeek);
        setLastWeekTotal(report.summary.completedLastWeek);
        setDailyCounts(report.dailyActivity.map((day) => day.count));
        setReportPatients(report.patients);
      })
      .catch((error: Error) => notify(error.message, true))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [authReady, demoMode, request, user]);

  const filteredPatients = useMemo(() => patients.filter((patient) => patient.name.toLowerCase().includes(search.toLowerCase())), [patients, search]);
  const average = patients.length ? Math.round(patients.reduce((sum, patient) => sum + patient.averageScore, 0) / patients.length) : 0;
  const totalExercises = patients.reduce((sum, patient) => sum + patient.completedExercises, 0);
  const completedThisWeek = weeklyTotal;
  const weeklyChange = lastWeekTotal ? Math.round(((weeklyTotal - lastWeekTotal) / lastWeekTotal) * 100) : null;
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    return new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(date).replace(".", "").slice(0, 1).toUpperCase();
  });
  const maxDailyCount = Math.max(...dailyCounts, 1);
  const titles: Record<View, string> = { overview: "Bom dia, doutora", patients: "Seus pacientes", tracks: "Trilhas terapêuticas", reports: "Acompanhar evolução" };

  async function createPatient(input: PatientInput) {
    if (demoMode) {
      const patient = { ...input, id: crypto.randomUUID(), completedExercises: 0, averageScore: 0 };
      setPatients((current) => [patient, ...current]);
      setReportPatients((current) => [{
        id: patient.id,
        name: patient.name,
        phoneme: patient.phoneme,
        track: patient.track,
        exerciseCount: 0,
        averageScore: 0,
        recentExercises: 0,
      }, ...current]);
      setShowCreate(false);
      notify("Paciente adicionado à demonstração.");
      return;
    }
    try {
      const payload = { ...input, ...(input.guardianUid ? {} : { guardianUid: undefined }) };
      await request("/patients", { method: "POST", body: JSON.stringify(payload) });
      const [patientList, report] = await Promise.all([request<Patient[]>("/patients"), request<ReportData>("/reports")]);
      setPatients(patientList);
      setActivities(report.activities);
      setWeeklyTotal(report.summary.completedThisWeek);
      setLastWeekTotal(report.summary.completedLastWeek);
      setDailyCounts(report.dailyActivity.map((day) => day.count));
      setReportPatients(report.patients);
      setShowCreate(false);
      notify("Paciente cadastrado com sucesso.");
    } catch (error) { notify(error instanceof Error ? error.message : "Não foi possível cadastrar.", true); }
  }

  async function updateTrack(patient: Patient, track: typeof trackCatalog[number]) {
    if (!demoMode) {
      try {
        await request(`/patients/${patient.id}/track`, { method: "PUT", body: JSON.stringify({ phoneme: track.phoneme, track: track.title }) });
      } catch (error) {
        notify(error instanceof Error ? error.message : "Não foi possível atualizar a trilha.", true);
        return;
      }
    }
    const updated = { ...patient, phoneme: track.phoneme, track: track.title };
    setPatients((current) => current.map((item) => item.id === patient.id ? updated : item));
    setReportPatients((current) => current.map((item) => item.id === patient.id ? { ...item, phoneme: track.phoneme, track: track.title } : item));
    setSelectedPatient(updated);
    notify("Trilha da semana atualizada.");
  }

  if (!authReady) return <div className="loading-screen"><Brand /><span>Preparando seu espaço de cuidado...</span></div>;
  if (!demoMode && !user) return <Login error={loginError} onLogin={async (email, password) => {
    setLoginError("");
    try {
      if (!auth) throw new Error("Firebase Auth não está configurado.");
      await signInWithEmailAndPassword(auth, email, password);
    } catch {
      setLoginError("Não foi possível entrar. Confira seu e-mail e sua senha.");
    }
  }} />;

  const displayName = demoMode ? "Dra. Karina" : loginEmail.split("@")[0].split(/[._-]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  const sectionDate = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  return <div className="app-shell">
    <aside className="sidebar">
      <Brand />
      <div className="workspace-label">ESPAÇO CLÍNICO</div>
      <div className="workspace-switch"><span className="workspace-avatar">K</span><span><strong>Meu consultório</strong><small>Plano profissional</small></span><span className="switch-chevron">⌄</span></div>
      <nav className="main-nav" aria-label="Navegação principal">
        {navItems.map((item) => <button key={item.view} className={`nav-item ${view === item.view ? "active" : ""}`} onClick={() => setView(item.view)}><span className="nav-icon">{item.icon}</span>{item.label}{item.view === "patients" && <span className="nav-count">{patients.length}</span>}</button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="tip-card"><span className="tip-icon"><Icon name="spark" size={19} /></span><strong>Uma dica para hoje</strong><p>Pequenos treinos todos os dias fazem uma grande diferença.</p><span className="tip-footer">LEMBRETE DA SEMANA</span></div>
        <div className="profile"><span className="profile-avatar">{demoMode ? "K" : initials(displayName)}</span><span className="profile-details"><strong>{displayName}</strong><small>Fonoaudióloga</small></span>
          {!demoMode && <button className="signout-button" onClick={() => auth && void signOut(auth)} title="Sair" aria-label="Sair">↗</button>}
        </div>
      </div>
    </aside>
    <main className="main-content">
      <header className="topbar">
        <div className="breadcrumb"><span>Meu consultório</span><span className="breadcrumb-slash">/</span><strong>{navItems.find((item) => item.view === view)?.label}</strong></div>
        <div className="topbar-actions"><label className="search-box"><Icon name="search" size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar paciente..." aria-label="Buscar paciente" /></label><button className="icon-button notification-button" aria-label="Notificações">♧<i /></button><Avatar name={displayName} tone="avatar-small" /></div>
      </header>
      <div className="page-wrap">
        <div className="page-heading"><div><p className="date-label"><Icon name="calendar" size={15} />{sectionDate}</p><h1>{view === "overview" ? <>{titles[view]}, <span>{displayName.split(" ")[0]}!</span></> : titles[view]}</h1><p className="page-subtitle">{view === "overview" ? "Veja o que está acontecendo com seus pequenos hoje." : view === "patients" ? "Cada jornada é única. Acompanhe todas por aqui." : view === "tracks" ? "Atividades pensadas para cada etapa da evolução." : "Cada conquista conta. Veja o caminho percorrido."}</p></div>
          {isTherapist && <button className="button button-primary" onClick={() => setShowCreate(true)}><Icon name="plus" size={18} />Novo paciente</button>}
        </div>
        {demoMode && <div className="demo-banner"><span>✳</span><div><strong>Você está explorando uma demonstração.</strong><span>Estes dados são fictícios e permanecem apenas nesta sessão. Configure o Firebase para conectar sua clínica.</span></div><button onClick={() => setView("patients")}>Explorar pacientes <Icon name="arrow" size={15} /></button></div>}
        {loading ? <div className="loading-state"><span className="spinner" />Carregando seus pacientes...</div> : <>
          {(view === "overview" || view === "reports") && <section className="stats-grid" aria-label="Resumo da evolução">
            <article className="stat-card"><div className="stat-top"><span>Pacientes ativos</span><span className="stat-icon stat-peach"><Icon name="people" /></span></div><div className="stat-number">{patients.length}<span className="stat-context">em acompanhamento</span></div><div className="stat-foot"><span className="positive-dot" />Cada jornada importa</div></article>
            <article className="stat-card"><div className="stat-top"><span>Treinos nesta semana</span><span className="stat-icon stat-lime"><Icon name="wave" /></span></div><div className="stat-number">{completedThisWeek}<span className="stat-context">exercícios concluídos</span></div><div className="stat-foot"><span className={`trend-pill ${weeklyChange !== null && weeklyChange < 0 ? "trend-down" : ""}`}>{weeklyChange === null ? "—" : `${weeklyChange > 0 ? "+" : ""}${weeklyChange}%`}</span>{weeklyChange === null ? "semana de referência indisponível" : "em relação à semana passada"}</div></article>
            <article className="stat-card"><div className="stat-top"><span>Aproveitamento médio</span><span className="stat-icon stat-violet"><Icon name="spark" /></span></div><div className="stat-number">{average}<span className="stat-percent">%</span><span className="stat-context">de acertos nos treinos</span></div><div className="stat-foot"><span className="positive-dot" />Aprender leva tempo. Está tudo bem.</div></article>
          </section>}
          {(view === "overview" || view === "patients") && <section className="content-section">
            <div className="section-heading"><div><span className="eyebrow">{view === "overview" ? "ACOMPANHAMENTO" : "SUA CARTEIRA"}</span><h2>{view === "overview" ? "Jornadas em andamento" : "Todos os pacientes"} <span className="heading-count">{filteredPatients.length}</span></h2></div><button className="link-button" onClick={() => setView("patients")}>Ver todos <Icon name="arrow" size={16} /></button></div>
            <div className="patient-grid">{filteredPatients.map((patient, index) => <article key={patient.id} className="patient-card">
              <div className="patient-card-head"><Avatar name={patient.name} tone={`avatar-tone-${index % 4}`} /><button className="more-button" aria-label={`Mais opções para ${patient.name}`} onClick={() => setSelectedPatient(patient)}>···</button></div>
              <button className="patient-name" onClick={() => setSelectedPatient(patient)}>{patient.name}</button><span className="patient-meta">{patient.guardianName ? `Responsável: ${patient.guardianName}` : "Paciente em acompanhamento"}</span>
              <div className={`track-chip chip-${trackCatalog.find((track) => track.phoneme === patient.phoneme)?.color ?? "mint"}`}><span className="chip-dot" />{patient.track}<strong>/ {patient.phoneme}</strong></div>
              <div className="progress-label"><span>Progresso dos treinos</span><strong>{patient.averageScore}%</strong></div><div className="progress-track"><span style={{ width: `${patient.averageScore}%` }} /></div>
              <div className="patient-card-foot"><span>{patient.completedExercises} exercícios feitos</span><button onClick={() => setSelectedPatient(patient)}>Ver detalhes <Icon name="arrow" size={15} /></button></div>
            </article>)}
              {filteredPatients.length === 0 && <div className="empty-state"><span>⌕</span><strong>Nenhum paciente encontrado</strong><p>Tente buscar por outro nome ou cadastre um novo paciente.</p></div>}
            </div>
          </section>}
          {(view === "overview" || view === "reports") && <section className="lower-grid">
            <article className="activity-card"><div className="section-heading"><div><span className="eyebrow">ACONTECEU POR AQUI</span><h2>Atividade recente</h2></div><button className="more-button" aria-label="Mais atividades">···</button></div>
              {activities.length ? <div className="activity-list">{activities.slice(0, 5).map((activity, index) => <div className="activity-row" key={activity.id}><Avatar name={activity.patientName} tone={`avatar-tone-${index % 4}`} /><div className="activity-info"><strong>{activity.patientName}</strong><span>concluiu {activity.exerciseType}</span></div><div className="activity-score"><strong>{activity.score}%</strong><span>{timeAgo(activity.completedAt)}</span></div></div>)}</div> : <div className="empty-activities">Os primeiros exercícios concluídos vão aparecer aqui.</div>}
            </article>
            <article className="week-card"><div className="section-heading"><div><span className="eyebrow">ÚLTIMOS 7 DIAS</span><h2>Ritmo de treinos</h2></div><span className="week-total">{weeklyTotal} <small>treinos</small></span></div>
              <div className="week-chart" aria-label="Treinos feitos em cada dia da semana">{dailyCounts.map((count, index) => <div className="chart-column" key={`${weekDays[index]}-${index}`}><div className={`chart-bar ${index === 6 ? "chart-bar-highlight" : ""}`} style={{ height: `${Math.max(4, count / maxDailyCount * 100)}%` }} title={`${count} treinos`} /><span>{weekDays[index]}</span></div>)}</div>
              <div className="chart-footer"><span><i className="chart-dot" />Exercícios concluídos</span><strong><span>↗</span> Consistência vale mais que pressa</strong></div>
            </article>
          </section>}
          {view === "tracks" && <section className="content-section"><div className="section-heading"><div><span className="eyebrow">PARA CADA SOM, UM CAMINHO</span><h2>Trilhas disponíveis</h2></div></div><div className="tracks-grid">{trackCatalog.map((track) => <article className={`track-card track-${track.color}`} key={track.phoneme}><div className="track-card-top"><span className="track-letter">{track.phoneme}</span><span className="track-category">{track.theme}</span></div><h3>{track.title}</h3><p>Exercícios de fonemas, rimas e consciência fonológica.</p><div className="word-chips">{track.words.map((word) => <span key={word}>{word}</span>)}</div><div className="track-card-foot"><span>{patients.filter((patient) => patient.phoneme === track.phoneme).length} pacientes nesta trilha</span><button onClick={() => setView("patients")}>Atribuir trilha <Icon name="arrow" size={15} /></button></div></article>)}</div></section>}
          {view === "reports" && <section className="content-section report-section"><div className="section-heading"><div><span className="eyebrow">VISÃO INDIVIDUAL</span><h2>Conquistas por paciente</h2></div></div><div className="report-table-wrap"><table className="report-table"><thead><tr><th>Paciente</th><th>Trilha atual</th><th>Exercícios</th><th>Últimos 7 dias</th><th>Aproveitamento</th></tr></thead><tbody>{reportPatients.map((patient, index) => <tr key={patient.id}><td><span className="table-person"><Avatar name={patient.name} tone={`avatar-tone-${index % 4}`} />{patient.name}</span></td><td><span className="report-phoneme">{patient.phoneme}</span> {patient.track}</td><td>{patient.exerciseCount}</td><td><span className="week-pill">{patient.recentExercises} treinos</span></td><td><span className="report-progress"><span><i style={{ width: `${patient.averageScore}%` }} /></span><strong>{patient.averageScore}%</strong></span></td></tr>)}</tbody></table>{!reportPatients.length && <div className="empty-activities">Cadastre um paciente para acompanhar a evolução.</div>}</div></section>}
        </>}
        <footer className="page-footer"><span>Feito com cuidado para cada voz.</span><span>{totalExercises} exercícios acompanhados</span></footer>
      </div>
    </main>
    {showCreate && <CreatePatient demoMode={demoMode} onClose={() => setShowCreate(false)} onCreate={createPatient} />}
    {selectedPatient && <PatientModal patient={selectedPatient} onClose={() => setSelectedPatient(null)} onTrackUpdate={updateTrack} request={request} demoMode={demoMode} user={user} canManage={isTherapist} notify={notify} />}
    {notice && <div className={`toast ${notice.error ? "toast-error" : ""}`} role="status"><span>{notice.error ? "!" : "✓"}</span>{notice.message}</div>}
  </div>;
}

function CreatePatient({ demoMode, onClose, onCreate }: { demoMode: boolean; onClose: () => void; onCreate: (input: PatientInput) => Promise<void> }) {
  const [form, setForm] = useState<PatientInput>({ name: "", birthDate: "", guardianName: "", phoneme: "R", track: "O som do R", guardianUid: "" });
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try { await onCreate(form); } finally { setSaving(false); }
  }
  function changePhoneme(phoneme: string) {
    const track = trackCatalog.find((item) => item.phoneme === phoneme);
    setForm((current) => ({ ...current, phoneme, track: track?.title ?? current.track }));
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
    <header className="modal-head"><div><span className="eyebrow">NOVO ACOMPANHAMENTO</span><h2 id="create-title">Uma nova jornada começa</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><Icon name="close" /></button></header>
    <form onSubmit={async (event) => { await submit(event); }} className="create-form">
      <label>Nome do paciente<input required minLength={2} maxLength={100} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nome completo" /></label>
      <div className="form-row"><label>Data de nascimento<input type="date" value={form.birthDate} onChange={(event) => setForm({ ...form, birthDate: event.target.value })} /></label><label>Responsável<input maxLength={100} value={form.guardianName} onChange={(event) => setForm({ ...form, guardianName: event.target.value })} placeholder="Nome do responsável" /></label></div>
      {!demoMode && <label>UID Firebase do responsável (opcional)<input maxLength={128} value={form.guardianUid} onChange={(event) => setForm({ ...form, guardianUid: event.target.value })} placeholder="Vincule a conta autenticada do responsável" /></label>}
      <label>Fonema da semana<select value={form.phoneme} onChange={(event) => changePhoneme(event.target.value)}>{trackCatalog.map((track) => <option key={track.phoneme} value={track.phoneme}>{track.phoneme} — {track.title}</option>)}</select></label>
      <div className="form-privacy"><Icon name="spark" size={17} /><span>Os dados clínicos são privados e ficam disponíveis apenas para contas autorizadas.</span></div>
      <div className="modal-actions"><button type="button" className="button button-ghost" onClick={onClose}>Cancelar</button><button className="button button-primary" disabled={saving}>{saving ? "Salvando..." : "Cadastrar paciente"}<Icon name="arrow" size={17} /></button></div>
    </form>
  </section></div>;
}

export default App;
