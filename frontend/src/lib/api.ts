import axios from 'axios';
import { getSession } from 'next-auth/react';

const api = axios.create({
  baseURL: '/api/backend',
});

api.interceptors.request.use(async (config) => {
  if (typeof window !== 'undefined') {
    const session = await getSession();
    if (session?.accessToken) {
      config.headers.Authorization = `Bearer ${session.accessToken}`;
    }
  }
  return config;
});

export default api;
