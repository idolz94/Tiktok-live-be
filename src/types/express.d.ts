import type { User } from "@supabase/supabase-js";

declare global {
  namespace Express {
    interface Request {
      authToken?: string;
      authUser?: User;
    }
  }
}

export {};
