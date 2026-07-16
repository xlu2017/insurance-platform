import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import type { DocumentCategory } from "@autopilot/schemas";
import { supabase, SUPABASE_URL } from "./supabase";

const ALLOWED_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
}

export async function pickDocument(): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/pdf", "image/*"],
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType ?? "application/octet-stream",
    size: asset.size,
  };
}

export async function pickImage(fromCamera: boolean): Promise<PickedFile | null> {
  const picker = fromCamera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
  if (fromCamera) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return null;
  }
  const result = await picker({ mediaTypes: ["images"], quality: 0.8 });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.fileName ?? `photo-${Date.now()}.jpg`,
    mimeType: asset.mimeType ?? "image/jpeg",
    size: "fileSize" in asset ? (asset.fileSize as number) : undefined,
  };
}

export interface UploadResult {
  path: string;
  id: string;
}

export async function uploadPolicyDocument(
  householdId: string,
  category: DocumentCategory,
  file: PickedFile,
): Promise<UploadResult> {
  const { data: session } = await supabase.auth.getSession();
  if (!session.session?.access_token) {
    throw new Error("You must be signed in to upload documents");
  }
  if (!ALLOWED_MIME_TYPES.includes(file.mimeType)) {
    throw new Error("Only PDF and PNG/JPEG images are allowed");
  }
  if (file.size !== undefined && file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error("File is too large (max 10 MB)");
  }
  if (file.size === undefined) {
    console.warn("File size not provided; server will enforce the limit");
  }

  const response = await fetch(file.uri);
  const blob = await response.blob();

  const form = new FormData();
  form.append("householdId", householdId);
  form.append("category", category);
  form.append("file", blob, file.name);

  const uploadRes = await fetch(`${SUPABASE_URL}/functions/v1/upload-document`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.session.access_token}`,
    },
    body: form,
  });

  const payload = (await uploadRes.json()) as { id?: string; path?: string; message?: string };
  if (!uploadRes.ok) {
    throw new Error(payload.message ?? `Upload failed (${uploadRes.status})`);
  }
  if (!payload.id || !payload.path) {
    throw new Error("Invalid server response");
  }

  return { path: payload.path, id: payload.id };
}
