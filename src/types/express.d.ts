declare global {
  namespace Express {
    interface Request {
      authToken?: string;
      authUserId?: string; // UUID from users.id
    }
  }
}

export {};
