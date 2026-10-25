import "dotenv/config";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { z, ZodError } from "zod";
import { authenticate, requireRole } from "./auth.js";
import { db, recordingsDirectory } from "./db.js";

const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";
const origins = (process.env.WEB_ORIGIN ?? "http://localhost:5173").split(",").map((origin) => origin.trim());

await app.register(helmet, { crossOriginResourcePolicy: { policy: "cross-origin" } });
await app.register(cors, { origin: origins, methods: ["GET", "POST", "PUT", "DELETE"] });
await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
await app.register(multipart, { limits: { files: 1, fileSize: 12 * 1024 * 1024 } });

app.decorateRequest("identity", null);

app.setErrorHandler((error, request, reply) => {
  if (error instanceof ZodError) {
    reply.code(400).send({ error: "Dados inválidos.", details: error.issues.map((issue) => issue.message) });
    return;
  }
  if (error instanceof Error && "statusCode" in error && typeof error.statusCode === "number" && error.statusCode < 500) {
    reply.code(error.statusCode).send({ error: error.message });
    return;
  }
  request.log.error(error);
  reply.code(500).send({ error: "Não foi possível concluir a solicitação." });
});

app.get("/api/health", async () => ({ status: "ok" }));

const authenticated = { preHandler: authenticate };
const therapistOnly = { preHandler: [authenticate, requireRole("therapist")] };
const patientIdSchema = z.string().uuid();

function requireIdentity(request: Parameters<typeof authenticate>[0]) {
  if (!request.identity) throw Object.assign(new Error("Sessão inválida."), { statusCode: 401 });
  return request.identity;
}

function patientForUser(patientId: string, uid: string, role: string) {
  const patient = db.prepare(`
    SELECT p.id, p.therapist_uid, p.name, p.birth_date, p.guardian_name, p.phoneme, p.track, p.created_at
    FROM patients p
    LEFT JOIN patient_guardians g ON g.patient_id = p.id
    WHERE p.id = ? AND (p.therapist_uid = ? OR g.guardian_uid = ?)
  `).get(patientId, role === "therapist" ? uid : "", role === "guardian" ? uid : "") as PatientRow | undefined;
  if (!patient) throw Object.assign(new Error("Paciente não encontrado."), { statusCode: 404 });
  return patient;
}

interface PatientRow {
  id: string;
  therapist_uid: string;
  name: string;
  birth_date: string | null;
  guardian_name: string | null;
  phoneme: string;
  track: string;
  created_at: string;
}

const patientInput = z.object({
  name: z.string().trim().min(2).max(100),
  birthDate: z.string().date().optional().or(z.literal("")),
  guardianName: z.string().trim().max(100).optional(),
  guardianUid: z.string().trim().min(1).max(128).optional(),
  phoneme: z.string().trim().min(1).max(16),
  track: z.string().trim().min(1).max(80),
});

app.get("/api/patients", authenticated, async (request) => {
  const identity = requireIdentity(request);
  const patients = db.prepare(`
    SELECT p.id, p.name, p.birth_date AS birthDate, p.guardian_name AS guardianName,
      p.phoneme, p.track, p.created_at AS createdAt,
      COUNT(DISTINCT pr.id) AS completedExercises,
      COALESCE(ROUND(AVG(pr.score)), 0) AS averageScore
    FROM patients p
    LEFT JOIN progress pr ON pr.patient_id = p.id
    WHERE (p.therapist_uid = ? AND ? = 'therapist')
      OR (? = 'guardian' AND EXISTS (
        SELECT 1 FROM patient_guardians g WHERE g.patient_id = p.id AND g.guardian_uid = ?
      ))
    GROUP BY p.id
    ORDER BY p.name COLLATE NOCASE
  `).all(identity.uid, identity.role, identity.role, identity.uid);
  return patients;
});

app.post("/api/patients", therapistOnly, async (request, reply) => {
  const identity = requireIdentity(request);
  const input = patientInput.parse(request.body);
  const id = randomUUID();
  const insertPatient = db.prepare(`
    INSERT INTO patients (id, therapist_uid, name, birth_date, guardian_name, phoneme, track)
    VALUES (@id, @therapist_uid, @name, @birth_date, @guardian_name, @phoneme, @track)
  `);
  const insertGuardian = db.prepare("INSERT INTO patient_guardians (patient_id, guardian_uid) VALUES (?, ?)");
  const createPatient = db.transaction(() => {
    insertPatient.run({
      id,
      therapist_uid: identity.uid,
      name: input.name,
      birth_date: input.birthDate || null,
      guardian_name: input.guardianName || null,
      phoneme: input.phoneme,
      track: input.track,
    });
    if (input.guardianUid) insertGuardian.run(id, input.guardianUid);
  });
  createPatient();
  reply.code(201);
  return db.prepare(`
    SELECT id, name, birth_date AS birthDate, guardian_name AS guardianName, phoneme, track, created_at AS createdAt
    FROM patients WHERE id = ?
  `).get(id);
});

app.put("/api/patients/:patientId/track", therapistOnly, async (request) => {
  const identity = requireIdentity(request);
  const patientId = patientIdSchema.parse((request.params as { patientId: string }).patientId);
  patientForUser(patientId, identity.uid, "therapist");
  const input = z.object({
    phoneme: z.string().trim().min(1).max(16),
    track: z.string().trim().min(1).max(80),
  }).parse(request.body);
  db.prepare("UPDATE patients SET phoneme = ?, track = ? WHERE id = ?").run(input.phoneme, input.track, patientId);
  return { ok: true };
});

app.post("/api/patients/:patientId/guardians", therapistOnly, async (request, reply) => {
  const identity = requireIdentity(request);
  const patientId = patientIdSchema.parse((request.params as { patientId: string }).patientId);
  patientForUser(patientId, identity.uid, "therapist");
  const { guardianUid } = z.object({ guardianUid: z.string().trim().min(1).max(128) }).parse(request.body);
  db.prepare("INSERT OR IGNORE INTO patient_guardians (patient_id, guardian_uid) VALUES (?, ?)").run(patientId, guardianUid);
  reply.code(204).send();
});

app.delete("/api/patients/:patientId", therapistOnly, async (request, reply) => {
  const identity = requireIdentity(request);
  const patientId = patientIdSchema.parse((request.params as { patientId: string }).patientId);
  patientForUser(patientId, identity.uid, "therapist");
  const recordings = db.prepare("SELECT file_path FROM recordings WHERE patient_id = ?").all(patientId) as Array<{ file_path: string }>;
  for (const recording of recordings) {
    try {
      await unlink(recording.file_path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  db.prepare("DELETE FROM patients WHERE id = ?").run(patientId);
  reply.code(204).send();
});

app.post("/api/patients/:patientId/progress", authenticated, async (request, reply) => {
  const identity = requireIdentity(request);
  const patientId = patientIdSchema.parse((request.params as { patientId: string }).patientId);
  patientForUser(patientId, identity.uid, identity.role ?? "");
  const input = z.object({
    exerciseType: z.string().trim().min(1).max(60),
    score: z.number().int().min(0).max(100),
  }).parse(request.body);
  const id = randomUUID();
  db.prepare("INSERT INTO progress (id, patient_id, exercise_type, score) VALUES (?, ?, ?, ?)")
    .run(id, patientId, input.exerciseType, input.score);
  reply.code(201);
  return { id };
});

app.get("/api/reports", authenticated, async (request) => {
  const identity = requireIdentity(request);
  const patients = db.prepare(`
    SELECT DISTINCT p.id, p.name, p.phoneme, p.track,
      COUNT(pr.id) AS exerciseCount,
      COALESCE(ROUND(AVG(pr.score)), 0) AS averageScore,
      SUM(CASE WHEN pr.completed_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS recentExercises
    FROM patients p
    LEFT JOIN progress pr ON pr.patient_id = p.id
    WHERE (p.therapist_uid = ? AND ? = 'therapist')
      OR (? = 'guardian' AND EXISTS (
        SELECT 1 FROM patient_guardians g WHERE g.patient_id = p.id AND g.guardian_uid = ?
      ))
    GROUP BY p.id
    ORDER BY p.name COLLATE NOCASE
  `).all(identity.uid, identity.role, identity.role, identity.uid);
  const activities = db.prepare(`
    SELECT pr.id, pr.patient_id AS patientId, p.name AS patientName, pr.exercise_type AS exerciseType,
      pr.score, pr.completed_at AS completedAt
    FROM progress pr JOIN patients p ON p.id = pr.patient_id
    WHERE (p.therapist_uid = ? AND ? = 'therapist')
      OR (? = 'guardian' AND EXISTS (
        SELECT 1 FROM patient_guardians g WHERE g.patient_id = p.id AND g.guardian_uid = ?
      ))
    ORDER BY pr.completed_at DESC LIMIT 30
  `).all(identity.uid, identity.role, identity.role, identity.uid);
  const summary = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN pr.completed_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END), 0) AS completedThisWeek,
      COALESCE(SUM(CASE WHEN pr.completed_at >= datetime('now', '-14 days')
        AND pr.completed_at < datetime('now', '-7 days') THEN 1 ELSE 0 END), 0) AS completedLastWeek
    FROM progress pr JOIN patients p ON p.id = pr.patient_id
    WHERE pr.completed_at >= datetime('now', '-14 days')
      AND ((p.therapist_uid = ? AND ? = 'therapist')
        OR (? = 'guardian' AND EXISTS (
          SELECT 1 FROM patient_guardians g WHERE g.patient_id = p.id AND g.guardian_uid = ?
        )))
  `).get(identity.uid, identity.role, identity.role, identity.uid);
  const dailyActivity = db.prepare(`
    SELECT date(pr.completed_at) AS date, COUNT(*) AS count
    FROM progress pr JOIN patients p ON p.id = pr.patient_id
    WHERE pr.completed_at >= datetime('now', '-7 days')
      AND ((p.therapist_uid = ? AND ? = 'therapist')
        OR (? = 'guardian' AND EXISTS (
          SELECT 1 FROM patient_guardians g WHERE g.patient_id = p.id AND g.guardian_uid = ?
        )))
    GROUP BY date(pr.completed_at)
  `).all(identity.uid, identity.role, identity.role, identity.uid) as Array<{ date: string; count: number }>;
  const countsByDate = new Map(dailyActivity.map(({ date, count }) => [date, count]));
  const weekDates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - (6 - index));
    return date.toISOString().slice(0, 10);
  });
  const dailyCounts = weekDates.map((date) => ({ date, count: countsByDate.get(date) ?? 0 }));
  return { patients, activities, summary, dailyActivity: dailyCounts };
});

const allowedAudioTypes = new Map([
  ["audio/webm", ".webm"],
  ["audio/wav", ".wav"],
  ["audio/x-wav", ".wav"],
  ["audio/mpeg", ".mp3"],
  ["audio/mp4", ".m4a"],
  ["audio/aac", ".aac"],
]);

app.get("/api/patients/:patientId/recordings", authenticated, async (request) => {
  const identity = requireIdentity(request);
  const patientId = patientIdSchema.parse((request.params as { patientId: string }).patientId);
  patientForUser(patientId, identity.uid, identity.role ?? "");
  return db.prepare(`
    SELECT id, original_name AS originalName, mime_type AS mimeType, size_bytes AS sizeBytes, created_at AS createdAt
    FROM recordings WHERE patient_id = ? ORDER BY created_at DESC
  `).all(patientId);
});

app.route({
  method: "POST",
  url: "/api/patients/:patientId/recordings",
  ...authenticated,
  config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  handler: async (request, reply) => {
  const identity = requireIdentity(request);
  const patientId = patientIdSchema.parse((request.params as { patientId: string }).patientId);
  patientForUser(patientId, identity.uid, identity.role ?? "");
  const upload = await request.file();
  if (!upload) throw Object.assign(new Error("Selecione um arquivo de áudio."), { statusCode: 400 });
  if (upload.fieldname !== "audio") {
    upload.file.resume();
    throw Object.assign(new Error("O campo do arquivo deve se chamar audio."), { statusCode: 400 });
  }
  const extension = allowedAudioTypes.get(upload.mimetype);
  if (!extension) {
    upload.file.resume();
    throw Object.assign(new Error("Formato não aceito. Envie WAV, MP3, M4A ou WebM."), { statusCode: 415 });
  }
  const buffer = await upload.toBuffer();
  if (buffer.length === 0) throw Object.assign(new Error("O arquivo de áudio está vazio."), { statusCode: 400 });
  const id = randomUUID();
  const filePath = resolve(recordingsDirectory, `${id}${extension}`);
  await mkdir(recordingsDirectory, { recursive: true });
  await writeFile(filePath, buffer, { flag: "wx" });
  try {
    db.prepare(`
      INSERT INTO recordings (id, patient_id, uploader_uid, original_name, mime_type, file_path, size_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, patientId, identity.uid, upload.filename.slice(0, 255), upload.mimetype, filePath, buffer.length);
  } catch (error) {
    await unlink(filePath);
    throw error;
  }
  reply.code(201);
    return { id, originalName: upload.filename, sizeBytes: buffer.length };
  },
});

app.get("/api/recordings/:recordingId/audio", authenticated, async (request, reply) => {
  const identity = requireIdentity(request);
  const recordingId = patientIdSchema.parse((request.params as { recordingId: string }).recordingId);
  const recording = db.prepare("SELECT * FROM recordings WHERE id = ?").get(recordingId) as RecordingRow | undefined;
  if (!recording) throw Object.assign(new Error("Gravação não encontrada."), { statusCode: 404 });
  patientForUser(recording.patient_id, identity.uid, identity.role ?? "");
  reply.header("Content-Type", recording.mime_type);
  reply.header("Content-Disposition", "inline");
  reply.header("Cache-Control", "private, no-store");
  return reply.send(createReadStream(recording.file_path));
});

interface RecordingRow {
  id: string;
  patient_id: string;
  uploader_uid: string;
  original_name: string;
  mime_type: string;
  file_path: string;
  size_bytes: number;
}

app.route({
  method: "POST",
  url: "/api/recordings/:recordingId/transcribe",
  ...therapistOnly,
  config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
  handler: async (request) => {
  const identity = requireIdentity(request);
  const recordingId = patientIdSchema.parse((request.params as { recordingId: string }).recordingId);
  const recording = db.prepare("SELECT * FROM recordings WHERE id = ?").get(recordingId) as RecordingRow | undefined;
  if (!recording) throw Object.assign(new Error("Gravação não encontrada."), { statusCode: 404 });
  patientForUser(recording.patient_id, identity.uid, "therapist");
  if (!process.env.OPENAI_API_KEY) {
    throw Object.assign(new Error("Transcrição indisponível: configure OPENAI_API_KEY no servidor."), { statusCode: 503 });
  }
  const { default: OpenAI, toFile } = await import("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const transcription = await client.audio.transcriptions.create({
    file: await toFile(createReadStream(recording.file_path), `${recording.id}${extname(recording.file_path)}`, {
      type: recording.mime_type,
    }),
    model: "whisper-1",
    language: "pt",
    response_format: "text",
  });
    return { text: transcription };
  },
});

app.listen({ port, host }).catch((error: unknown) => {
  app.log.error(error);
  process.exitCode = 1;
});
