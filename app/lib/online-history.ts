import "server-only";

import { createClient } from "@supabase/supabase-js";

const HISTORY_BUCKET = "notebook-drawings";

type OnlineHistoryEntry = {
  notebookId: string;
  question: string;
  answer: string;
  image: string;
  model: string;
};

export function isOnlineHistoryConfigured() {
  return Boolean(process.env.SUPABASE_URL && supabaseSecret());
}

export async function storeNotebookHistory(entry: OnlineHistoryEntry) {
  const url = process.env.SUPABASE_URL;
  const secret = supabaseSecret();
  if (!url || !secret) return;

  const parsedImage = parseDataImage(entry.image);
  if (!parsedImage) throw new Error("Unsupported notebook history image.");

  const supabase = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const storageId = crypto.randomUUID();
  const date = new Date().toISOString().slice(0, 10);
  const drawingPath = `${date}_${storageId}.${parsedImage.extension}`;
  const drawing = Buffer.from(parsedImage.data, "base64");

  const { error: uploadError } = await supabase.storage
    .from(HISTORY_BUCKET)
    .upload(drawingPath, drawing, {
      contentType: parsedImage.mimeType,
      upsert: false,
    });

  if (uploadError) throw uploadError;

  const { error: insertError } = await supabase.from("notebook_history").insert({
    notebook_id: entry.notebookId,
    drawing_path: drawingPath,
    question: entry.question,
    answer: entry.answer,
    model: entry.model,
  });

  if (!insertError) return;

  await supabase.storage.from(HISTORY_BUCKET).remove([drawingPath]);
  throw insertError;
}

function supabaseSecret() {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function parseDataImage(image: string) {
  const match = /^data:(image\/(png|webp));base64,([a-z0-9+/=]+)$/i.exec(image);
  if (!match) return null;
  return {
    mimeType: match[1],
    extension: match[2].toLowerCase(),
    data: match[3],
  };
}
