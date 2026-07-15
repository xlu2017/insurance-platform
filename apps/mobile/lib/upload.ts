import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "./supabase";

export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
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
  };
}

export async function uploadPolicyDocument(
  householdId: string,
  category: string,
  file: PickedFile,
): Promise<string> {
  const path = `${householdId}/${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
  const response = await fetch(file.uri);
  const blob = await response.arrayBuffer();
  const { error: storageError } = await supabase.storage
    .from("policy-documents")
    .upload(path, blob, { contentType: file.mimeType });
  if (storageError) throw storageError;

  const { error } = await supabase.from("policy_documents").insert({
    household_id: householdId,
    category,
    status: "uploaded",
    storage_path: path,
    file_name: file.name,
    mime_type: file.mimeType,
  });
  if (error) throw error;
  return path;
}
