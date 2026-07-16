import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import type { DocumentCategory } from "@autopilot/schemas";
import { supabase } from "./supabase";

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
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    throw new Error("You must be signed in to upload documents");
  }
  if (!ALLOWED_MIME_TYPES.includes(file.mimeType)) {
    throw new Error("Only PDF and PNG/JPEG images are allowed");
  }
  if (file.size !== undefined && file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error("File is too large (max 10 MB)");
  }
  if (file.size === undefined) {
    // Picked files may not report size; the bucket policy and row size still protect the system.
    console.warn("File size not provided; skipping size validation");
  }

  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const randomSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const path = `${householdId}/${randomSuffix}-${safeName}`;

  const response = await fetch(file.uri);
  const blob = await response.arrayBuffer();

  const { error: storageError } = await supabase.storage
    .from("policy-documents")
    .upload(path, blob, { contentType: file.mimeType });
  if (storageError) throw storageError;

  const { data: inserted, error } = await supabase
    .from("policy_documents")
    .insert({
      household_id: householdId,
      category,
      status: "uploaded",
      storage_path: path,
      file_name: file.name,
      mime_type: file.mimeType,
      size_bytes: file.size ?? 0,
      uploaded_by: userData.user.id,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    // Best-effort cleanup so a failed metadata write does not orphan the object.
    await supabase.storage.from("policy-documents").remove([path]);
    throw new Error(error?.message ?? "Failed to save document metadata");
  }

  return { path, id: inserted.id };
}
