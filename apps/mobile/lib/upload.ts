import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import type { DocumentCategory } from "@autopilot/schemas";
import {
  getBypassTunnelHeaders,
  getSupabaseAnonKeyString,
  getSupabaseUrlString,
  supabase,
} from "./supabase";

const ALLOWED_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
}

export async function pickDocuments(): Promise<PickedFile[]> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/pdf", "image/*"],
    copyToCacheDirectory: true,
    multiple: true,
  });
  if (result.canceled) return [];
  return result.assets.map((asset) => ({
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType ?? "application/octet-stream",
    size: asset.size,
  }));
}

export async function pickDocument(): Promise<PickedFile | null> {
  return (await pickDocuments())[0] ?? null;
}

export async function pickImages(fromCamera: boolean): Promise<PickedFile[]> {
  const picker = fromCamera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
  if (fromCamera) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return [];
  }
  const result = await picker({
    mediaTypes: ["images"],
    quality: 0.8,
    allowsMultipleSelection: !fromCamera,
  });
  if (result.canceled) return [];
  return result.assets.map((asset) => ({
    uri: asset.uri,
    name: asset.fileName ?? `photo-${Date.now()}.jpg`,
    mimeType: asset.mimeType ?? "image/jpeg",
    size: "fileSize" in asset ? (asset.fileSize as number) : undefined,
  }));
}

export async function pickImage(fromCamera: boolean): Promise<PickedFile | null> {
  return (await pickImages(fromCamera))[0] ?? null;
}

export interface UploadResult {
  path: string;
  id: string;
  batchId: string;
  itemId: string;
  deduplicated: boolean;
}

export async function uploadPolicyDocument(
  householdId: string,
  category: DocumentCategory,
  file: PickedFile,
  batchId?: string,
  clientItemId?: string,
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

  const parameters: Record<string, string> = {
    householdId,
    category,
  };
  if (batchId) parameters.batchId = batchId;
  if (clientItemId) parameters.clientItemId = clientItemId;

  const url = `${getSupabaseUrlString()}/functions/v1/upload-document`;
  const headers = {
    Authorization: `Bearer ${session.session.access_token}`,
    apikey: getSupabaseAnonKeyString(),
    ...getBypassTunnelHeaders(),
  };

  let uploadRes: { status: number; body: string };
  if (Platform.OS === "web") {
    const fileResponse = await fetch(file.uri);
    const blob = await fileResponse.blob();
    const formData = new FormData();
    formData.append("file", blob, file.name);
    Object.entries(parameters).forEach(([key, value]) => formData.append(key, value));
    const response = await fetch(url, { method: "POST", headers, body: formData });
    uploadRes = { status: response.status, body: await response.text() };
  } else {
    uploadRes = await FileSystem.uploadAsync(url, file.uri, {
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: "file",
      mimeType: file.mimeType,
      parameters,
      headers,
    });
  }

  const payload = (() => {
    try {
      return JSON.parse(uploadRes.body) as {
        id?: string;
        path?: string;
        batch_id?: string;
        item_id?: string;
        deduplicated?: boolean;
        message?: string;
      };
    } catch {
      return {};
    }
  })();
  if (uploadRes.status < 200 || uploadRes.status >= 300) {
    throw new Error(payload.message ?? `Upload failed (${uploadRes.status})`);
  }
  if (!payload.id || !payload.path || !payload.batch_id || !payload.item_id) {
    throw new Error("Invalid server response");
  }

  return {
    path: payload.path,
    id: payload.id,
    batchId: payload.batch_id,
    itemId: payload.item_id,
    deduplicated: payload.deduplicated === true,
  };
}

export function createClientItemId(): string {
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function deletePolicyDocument(documentId: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  if (!session.session?.access_token) {
    throw new Error("You must be signed in to remove documents");
  }

  const response = await fetch(`${getSupabaseUrlString()}/functions/v1/delete-document`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.session.access_token}`,
      "Content-Type": "application/json",
      apikey: getSupabaseAnonKeyString(),
      ...getBypassTunnelHeaders(),
    },
    body: JSON.stringify({ documentId }),
  });
  const payload = (await response.json()) as { message?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? `Remove failed (${response.status})`);
  }
}
