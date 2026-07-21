import { Redirect } from "expo-router";
import { Loading } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";

export default function Index() {
  const { status, isAuthenticated } = useAuth();

  if (status === "loading") return <Loading />;
  if (isAuthenticated) return <Redirect href="/home" />;
  return <Redirect href="/welcome" />;
}
