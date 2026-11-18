'use client';

import { Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { Field, Input, Textarea } from '@/components/ui/form';
import { ApiError, api, toErrorMessage } from '@/lib/client/api';
import { cn } from '@/lib/utils';

/**
 * Review submission form.
 *
 * The rating is a radio group, not a row of buttons: that gives arrow-key
 * navigation and a single tab stop for free, which a set of buttons does not.
 * The visible stars are decorative; the accessible name comes from each radio's
 * label.
 */
export const ReviewForm = ({
  productId,
  productName,
  moderated,
}: {
  productId: string;
  productName: string;
  moderated: boolean;
}) => {
  const router = useRouter();

  const [rating, setRating] = useState(0);
  const [authorName, setAuthorName] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    if (rating < 1) {
      setFieldErrors({ rating: 'Choose a rating from 1 to 5 stars.' });
      return;
    }

    setSaving(true);
    try {
      const result = await api.post<{ message: string }>('/api/shop/reviews', {
        productId,
        authorName,
        rating,
        title: title.trim() === '' ? undefined : title,
        body,
      });

      setDone(result.message);
      setRating(0);
      setAuthorName('');
      setTitle('');
      setBody('');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(error.byField);
        setFormError(error.message);
        return;
      }
      setFormError(toErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <Card as="section">
        <CardHeader>
          <CardTitle as="h3">Thank you</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert tone="success">{done}</Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card as="section">
      <CardHeader>
        <CardTitle as="h3">Write a review</CardTitle>
      </CardHeader>

      <CardContent>
        <form onSubmit={(event) => void submit(event)} noValidate className="space-y-4">
          {formError ? <Alert tone="danger">{formError}</Alert> : null}

          <fieldset>
            <legend className="text-fg mb-1.5 text-sm font-medium">
              Your rating
              <span aria-hidden="true" className="text-danger ml-0.5">
                *
              </span>
              <span className="sr-only"> (required)</span>
            </legend>

            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((value) => (
                <label
                  key={value}
                  className={cn(
                    'grid size-11 cursor-pointer place-items-center rounded-md',
                    'hover:bg-surface-sunken focus-within:outline-ring focus-within:outline-2',
                  )}
                >
                  <input
                    type="radio"
                    name="rating"
                    value={value}
                    checked={rating === value}
                    onChange={() => {
                      setRating(value);
                      setFieldErrors({});
                    }}
                    className="sr-only"
                  />
                  <span className="sr-only">
                    {value} star{value === 1 ? '' : 's'}
                  </span>
                  <Star
                    aria-hidden="true"
                    className={cn(
                      'size-6',
                      value <= rating ? 'fill-warning text-warning' : 'text-fg-subtle',
                    )}
                  />
                </label>
              ))}
            </div>

            {fieldErrors.rating ? (
              <p role="alert" className="text-danger mt-1 text-xs font-medium">
                {fieldErrors.rating}
              </p>
            ) : null}
          </fieldset>

          <Field label="Your name" error={fieldErrors.authorName} required>
            {(props) => (
              <Input
                {...props}
                value={authorName}
                onChange={(event) => setAuthorName(event.target.value)}
                autoComplete="name"
              />
            )}
          </Field>

          <Field label="Headline" error={fieldErrors.title}>
            {(props) => (
              <Input
                {...props}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Sums up your experience"
              />
            )}
          </Field>

          <Field
            label="Your review"
            error={fieldErrors.body}
            required
            hint={`What did you think of the ${productName}?`}
          >
            {(props) => (
              <Textarea
                {...props}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={4}
              />
            )}
          </Field>

          <Button type="submit" block loading={saving} loadingLabel="Submitting review">
            Submit review
          </Button>

          {moderated ? (
            <p className="text-fg-subtle text-xs leading-relaxed">
              Reviews are checked before they appear, so yours may take a little while to show up.
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
};
