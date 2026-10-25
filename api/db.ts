import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const databasePath = resolve(process.env.DATABASE_PATH ?? "./data/fonoaudioplay.sqlite");
mkdirSync(dirname(databasePath), { recursive: true });

export const recordingsDirectory = resolve(process.env.RECORDINGS_DIR ?? "./data/recordings");
mkdirSync(recordingsDirectory, { recursive: true });

export const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS patients (
    id TEXT PRIMARY KEY,
    therapist_uid TEXT NOT NULL,
    name TEXT NOT NULL,
    birth_date TEXT,
    guardian_name TEXT,
    phoneme TEXT NOT NULL,
    track TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS patient_guardians (
    patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    guardian_uid TEXT NOT NULL,
    PRIMARY KEY (patient_id, guardian_uid)
  );

  CREATE TABLE IF NOT EXISTS progress (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    exercise_type TEXT NOT NULL,
    score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
    completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS recordings (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    uploader_uid TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_patients_therapist ON patients(therapist_uid);
  CREATE INDEX IF NOT EXISTS idx_guardians_uid ON patient_guardians(guardian_uid);
  CREATE INDEX IF NOT EXISTS idx_progress_patient_date ON progress(patient_id, completed_at);
  CREATE INDEX IF NOT EXISTS idx_recordings_patient_date ON recordings(patient_id, created_at);
`);
