import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Loading } from "@/components/ui";

export default function Index() {
  const [state, setState] = useState<"loading" | "signed-out" | "signed-in">("loading");

  useEffect(() => {
    let mounted = true;
    const timeout = setTimeout(() => {
      if (mounted) setState((s) => (s === "loading" ? "signed-out" : s));
    }, 3_000);

    const check = () =>
      supabase.auth
        .getSession()
        .then(({ data }) => {
          if (mounted) setState(data.session ? "signed-in" : "signed-out");
        })
        .catch(() => {
          if (mounted) setState("signed-out");
        });

    check();

    const { data: subscription } = supabase.auth.onAuthStateChange(() => check());

    return () => {
      mounted = false;
      clearTimeout(timeout);
      subscription.subscription.unsubscribe();
    };
  }, []);

  if (state === "loading") return <Loading />;
  if (state === "signed-out") return <Redirect href="/welcome" />;
  return <Redirect href="/home" />;
}
