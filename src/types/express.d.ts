declare global {
  namespace Express {
    interface Request {
      authToken?: string;
      authUserId?: string; // Clerk user id (sub from JWT)
    }
  }
}

export {};
