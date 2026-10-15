import { Suspense } from 'react';
import ResetPasswordForm from './ResetPasswordForm';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

function Loading() {
  return (
    <main className='relative flex min-h-screen items-center justify-center overflow-hidden p-6'>
      <div className='relative z-10 mx-auto w-full max-w-md'>
        <div className='mb-8 text-center'>
          <div className='mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl shadow-primary animate-pulse'>
            <div className='w-8 h-8 border-4 border-primary border-t-transparent rounded-full' />
          </div>
        </div>
      </div>
    </main>
  );
}

export default async function ResetPasswordPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const token = params.token || null;

  return (
    <Suspense fallback={<Loading />}>
      <ResetPasswordForm token={token} />
    </Suspense>
  );
}