'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Layers, ArrowLeft, ArrowRight, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorBanner, PANEL_CLASS, PanelTitle } from '@/components/ui/panel';
import { BRAND_GRADIENT } from '@/components/Navbar';
import { errorMessage, notifySuccess } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

const FALLBACK = 'Unable to send reset instructions. Please try again later.';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const emailId = React.useId();

  useEffect(() => { document.title = 'Forgot password \u00b7 Enterprise Operations Hub'; }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await api.forgotPassword(email.trim().toLowerCase());
      setSubmitted(true);
      notifySuccess('If an account exists, a password reset link has been sent to your email.');
    } catch (err) {
      setError(errorMessage(err, FALLBACK));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className='relative flex min-h-screen items-center justify-center overflow-hidden p-6'>
      <div aria-hidden='true' className='absolute inset-0 -z-10'>
        <div className='absolute left-1/4 top-1/3 h-96 w-96 rounded-full bg-primary/5 blur-3xl' />
        <div className='absolute bottom-1/3 right-1/4 h-96 w-96 rounded-full bg-primary/5 blur-3xl' />
      </div>
      <div className='relative z-10 mx-auto w-full max-w-md'>
        <div className='mb-8 text-center'>
          <div style={{ backgroundImage: BRAND_GRADIENT }} className='mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl shadow-primary'>
            <Layers size={28} className='text-primary-foreground' aria-hidden='true' />
          </div>
          <h1 className='text-3xl font-bold tracking-tight text-foreground'>Reset your password</h1>
          <p className='mt-2 text-sm text-muted-foreground'>Enter your corporate email and we'll send you a password reset link</p>
        </div>
        <div className={cn(PANEL_CLASS, 'p-5 sm:p-6')}>
          {!submitted ? (
            <>
              <PanelTitle title='Forgot password' description="We'll email a password reset link to your registered email address." />
              {error && <ErrorBanner message={error} className='mt-4' />}
              <form onSubmit={handleSubmit} className='mt-5 flex flex-col gap-5'>
                <div className='space-y-1.5'>
                  <Label htmlFor={emailId} className='block text-foreground'>Corporate Email Address</Label>
                  <Input
                    id={emailId}
                    type='email'
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder='name@company.com'
                    required
                    autoComplete='email'
                  />
                </div>
                <Button type='submit' loading={isLoading} size='lg' className='mt-2 w-full'>
                  <span>{isLoading ? 'Sending...' : 'Send reset link'}</span>
                  <ArrowRight size={18} aria-hidden='true' />
                </Button>
              </form>
              <div className='mt-6 text-center'>
                <Link href='/login' className='inline-flex items-center gap-2 text-sm text-primary hover:underline'>
                  <ArrowLeft size={16} aria-hidden='true' /> Back to sign in
                </Link>
              </div>
            </>
          ) : (
            <>
              <div className='text-center'>
                <CheckCircle className='mx-auto h-12 w-12 text-green-600' aria-hidden='true' />
                <PanelTitle title='Check your email' description="If an account with that email exists, we've sent a password reset link to it." />
                <p className='mt-3 text-sm text-muted-foreground'>For security reasons, we do not reveal whether an account exists.</p>
                <p className='mt-2 text-sm text-muted-foreground'>The link will expire in 1 hour.</p>
              </div>
              <div className='mt-6 flex flex-col gap-3'>
                <Button asChild variant='outline' className='w-full'>
                  <Link href='/login'>Back to sign in <ArrowLeft size={18} className='ml-2' aria-hidden='true' /></Link>
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}