import type {
  AuthorizationStore,
  DocumentProcessingAuthorization,
} from "./native-document-analysis.ts";

export class MemoryAuthorizationStore implements AuthorizationStore {
  private authorizations = new Map<string, DocumentProcessingAuthorization>();

  async createAuthorization(
    auth: Omit<DocumentProcessingAuthorization, "id" | "authorizedAt">,
  ): Promise<DocumentProcessingAuthorization> {
    const created: DocumentProcessingAuthorization = {
      ...auth,
      id: crypto.randomUUID(),
      authorizedAt: new Date().toISOString(),
    };
    this.authorizations.set(created.id, created);
    return created;
  }

  async updateAuthorization(
    id: string,
    patch: Partial<DocumentProcessingAuthorization>,
  ): Promise<void> {
    const auth = this.authorizations.get(id);
    if (!auth) throw new Error(`Authorization ${id} not found`);
    Object.assign(auth, patch);
  }

  get(id: string): DocumentProcessingAuthorization | undefined {
    return this.authorizations.get(id);
  }
}
