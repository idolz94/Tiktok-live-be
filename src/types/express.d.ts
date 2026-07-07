declare global {
  namespace Express {
    interface Request {
      authToken?: string;
      authUserId?: string; // UUID from users.id
      authUserRole?: string; // user | admin | manager
      requestId?: string;
    }
  }
}

export {};
