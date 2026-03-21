import { redirect } from '@remix-run/react';
import type { ClientLoaderFunctionArgs } from '@remix-run/react';

export const clientLoader = async (_args: ClientLoaderFunctionArgs) => {
  return redirect('/admin/shoppers');
};

export default function AdminIndex() {
  return null;
}
