import { router } from "expo-router";
import { useEffect } from "react";
import { Loading } from "@/components/ui";
import { supabase } from "@/lib/supabase";

export default function AuthCallback() {
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session) {
        router.replace("/home");
      } else {
        router.replace("/welcome");
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  return <Loading />;
}
