import type { Metadata } from 'next';

import { ForgotPasswordForm } from './forgot-password-form';

export const metadata: Metadata = {
  title: 'Forgot password',
  robots: { index: false, follow: false },
};

const ForgotPasswordPage = () => <ForgotPasswordForm />;

export default ForgotPasswordPage;
