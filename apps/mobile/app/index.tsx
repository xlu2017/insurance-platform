import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Loading } from "@/components/ui";

export default function Index() {
  const [state, setState] = useState<"loading" | "signed-out" | "signed-in">("loading");

  useEffect(() => {
    let mounted = true;
    const timeout = setTimeout(() => {
      if (mounted && state === "loading") setState("signed-out");
    }, 3_000);

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (mounted) setState(data.session ? "signed-in" : "signed-out");
      })
      .catch(() => {
        if (mounted) setState("signed-out");
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      mounted = false;
      clearTimeout(timeout);
    };
  }, []);

  if (state === "loading") return <Loading />;
  if (state === "signed-out") return <Redirect href="/welcome" />;
  return <Redirect href="/(tabs)/home" />;
}
