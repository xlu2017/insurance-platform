import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Loading } from "@/components/ui";

export default function Index() {
  const [state, setState] = useState<"loading" | "signed-out" | "signed-in">("loading");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setState(data.session ? "signed-in" : "signed-out");
    });
  }, []);

  if (state === "loading") return <Loading />;
  if (state === "signed-out") return <Redirect href="/welcome" />;
  return <Redirect href="/(tabs)/home" />;
}
