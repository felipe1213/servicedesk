import axios from 'axios';
import { getSession } from 'next-auth/react';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
});

api.interceptors.request.use(async (config) => {
  if (typeof window !== 'undefined') {
    const session = await getSession();
    if (session && (session as any).accessToken) {
      config.headers.Authorization = `Bearer ${(session as any).accessToken}`;
    }
  }
  return config;
});

export default api;
