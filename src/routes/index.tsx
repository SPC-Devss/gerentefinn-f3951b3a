import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { createThread, listThreads } from "@/lib/threads.functions";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
    const threads = await listThreads();
    if (threads.length > 0) {
      throw redirect({ to: "/chat/$threadId", params: { threadId: threads[0].id } });
    }
    const fresh = await createThread({ data: {} });
    throw redirect({ to: "/chat/$threadId", params: { threadId: fresh.id } });
  },
  component: () => null,
});
