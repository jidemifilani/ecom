import type { Metadata } from 'next';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { CustomerForgotPasswordForm } from '../account-forms';

export const metadata: Metadata = {
  title: 'Reset your password',
  robots: { index: false, follow: false },
};

const CustomerForgotPasswordPage = () => (
  <div className="mx-auto w-full max-w-md px-4 py-10 sm:px-6">
    <Card as="section">
      <CardHeader>
        <CardTitle as="h1">Reset your password</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-fg-muted mb-5 text-sm leading-relaxed">
          Enter the email address on your account and we will send you a link to choose a new
          password.
        </p>
        <CustomerForgotPasswordForm />
      </CardContent>
    </Card>
  </div>
);

export default CustomerForgotPasswordPage;
