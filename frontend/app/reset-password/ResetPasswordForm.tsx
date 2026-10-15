'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Layers, ArrowLeft, ArrowRight, CheckCircle, Lock, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorBanner, PANEL_CLASS, PanelTitle } from '@/components/ui/panel';
import { BRAND_GRADIENT } from '@/components/Navbar';
import { errorMessage, notifySuccess } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

const FALLBACK = 'Unable to reset password. Please try again later.';

interface ResetPasswordFormProps {
  token: string | null;
}

export default function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const passwordId = React.useId();
  const confirmId = React.useId();

  useEffect(() => { document.title = 'Reset password \u00b7 Enterprise Operations Hub'; }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!token) {
      setError('Invalid or missing reset token. Please request a new password reset.');
      return;
    }
    
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    
    if (newPassword.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }
    
    if (!/[A-Z]/.test(newPassword)) {
      setError('Password must contain at least one uppercase letter.');
      return;
    }
    
    if (!/[a-z]/.test(newPassword)) {
      setError('Password must contain at least one lowercase letter.');
      return;
    }
    
    if (!/\d/.test(newPassword)) {
      setError('Password must contain at least one number.');
      return;
    }
    
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword)) {
      setError('Password must contain at least one special character.');
      return;
    }

    setIsLoading(true);
    try {
      await api.resetPassword(token, newPassword);
      setSuccess(true);
      notifySuccess('Password has been reset successfully.');
    } catch (err) {
      setError(errorMessage(err, FALLBACK));
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
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
          </div>
          <div className={cn(PANEL_CLASS, 'p-5 sm:p-6')}>
            <div className='text-center'>
              <AlertCircle className='mx-auto h-12 w-12 text-red-600' aria-hidden='true' />
              <PanelTitle title='Invalid reset link' description='This password reset link is invalid or has expired.' />
              <p className='mt-3 text-sm text-muted-foreground'>Please request a new password reset link.</p>
            </div>
            <div className='mt-6 flex flex-col gap-3'>
              <Button asChild variant='outline' className='w-full'>
                <Link href='/forgot-password'>Request new link <ArrowLeft size={18} className='ml-2' aria-hidden='true' /></Link>
              </Button>
            </div>
          </div>
        </div>
      </main>
    );
  }

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
          <h1 className='text-3xl font-bold tracking-tight text-foreground'>Set new password</h1>
          <p className='mt-2 text-sm text-muted-foreground'>Enter your new password below. This link expires in 1 hour.</p>
        </div>
        <div className={cn(PANEL_CLASS, 'p-5 sm:p-6')}>
          {!success ? (
            <>
              <PanelTitle title='New password' description='Your new password must be different from previous passwords.' />
              {error && <ErrorBanner message={error} className='mt-4' />}
              <form onSubmit={handleSubmit} className='mt-5 flex flex-col gap-5'>
                <div className='space-y-1.5'>
                  <Label htmlFor={passwordId} className='block text-foreground'>New Password</Label>
                  <div className='relative'>
                    <Lock size={18} className='absolute left-1/2 top-1/2 -translate-y-1/2 text-muted-foreground' aria-hidden='true' />
                    <Input
                      id={passwordId}
                      type={showPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder='Enter new password'
                      className='pl-10 pr-10'
                      required
                      autoComplete='new-password'
                    />
                    <button
                      type='button'
                      onClick={() => setShowPassword(!showPassword)}
                      className='absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground'
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <p className='text-xs text-muted-foreground'>
                    Min 12 chars, upper, lower, number, special
                  </p>
                </div>
                <div className='space-y-1.5'>
                  <Label htmlFor={confirmId} className='block text-foreground'>Confirm New Password</Label>
                  <div className='relative'>
                    <Lock size={18} className='absolute left-1/2 top-1/2 -translate-y-1/2 text-muted-foreground' aria-hidden='true' />
                    <Input
                      id={confirmId}
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      placeholder='Confirm new password'
                      className='pl-10 pr-3'
                      required
                      autoComplete='new-password'
                    />
                  </div>
                </div>
                <Button type='submit' loading={isLoading} size='lg' className='mt-2 w-full'>
                  <span>{isLoading ? 'Resetting...' : 'Reset password'}</span>
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
                <PanelTitle title='Password reset successful' description='Your password has been updated. You can now sign in with your new password.' />
              </div>
              <div className='mt-6 flex flex-col gap-3'>
                <Button asChild className='w-full'>
                  <Link href='/login'>Sign in <ArrowRight size={18} className='ml-2' aria-hidden='true' /></Link>
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}