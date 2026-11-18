import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '@/components/ui/button';
import { Field, Input, PasswordInput, SwitchField } from '@/components/ui/form';
import { Badge, StatusBadge } from '@/components/ui/feedback';

/**
 * Component tests, focused on the accessibility contract rather than on markup.
 *
 * Each of these asserts something a user depends on: that a label is really
 * associated with its control, that an error is announced and linked, that
 * status is readable without colour, and that a submitting button cannot be
 * double-clicked.
 */

describe('Field', () => {
  it('associates the label, hint and error with the control', () => {
    render(
      <Field label="Email address" hint="We never share it" error="Enter a valid email" required>
        {(props) => <Input {...props} />}
      </Field>,
    );

    // getByLabelText only succeeds if the label is properly associated.
    const input = screen.getByLabelText(/email address/i);

    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');

    // The hint and the error must both be referenced by aria-describedby.
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(describedBy.split(' ').length).toBe(2);

    for (const id of describedBy.split(' ')) {
      expect(document.getElementById(id)).toBeInTheDocument();
    }

    expect(screen.getByText('We never share it')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email');
  });

  it('marks a required field for screen readers as well as visually', () => {
    render(
      <Field label="Full name" required>
        {(props) => <Input {...props} />}
      </Field>,
    );

    expect(screen.getByText('(required)')).toBeInTheDocument();
  });

  it('omits aria-invalid and the alert when there is no error', () => {
    render(
      <Field label="Phone">
        {(props) => <Input {...props} />}
      </Field>,
    );

    expect(screen.getByLabelText('Phone')).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the label available to assistive tech when visually hidden', () => {
    render(
      <Field label="Search products" labelHidden>
        {(props) => <Input {...props} />}
      </Field>,
    );

    expect(screen.getByLabelText('Search products')).toBeInTheDocument();
  });
});

describe('Button', () => {
  it('defaults to type="button" so it does not submit a form by accident', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });

  it('disables itself and reports busy while loading, preventing a double submit', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');

    await userEvent.click(button).catch(() => undefined);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('announces the loading state in text, not just with a spinner', () => {
    render(
      <Button loading loadingLabel="Saving your changes">
        Save
      </Button>,
    );

    expect(screen.getByText('Saving your changes')).toBeInTheDocument();
  });

  it('calls its handler when enabled', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Apply</Button>);

    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('PasswordInput', () => {
  it('toggles visibility and reports its state', async () => {
    render(<PasswordInput value="hunter2" onChange={() => {}} aria-label="Password" />);

    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');

    const toggle = screen.getByRole('button', { name: /show password/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(toggle);

    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: /hide password/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('shows the requirement checklist with met and unmet state in text', () => {
    render(
      <PasswordInput
        value="short"
        onChange={() => {}}
        aria-label="New password"
        showRequirements
        minLength={12}
      />,
    );

    // The length requirement is unmet for "short".
    expect(screen.getByText('At least 12 characters')).toBeInTheDocument();
    // State is conveyed in text, not only by icon colour.
    expect(screen.getAllByText(/^Not met:$/).length).toBeGreaterThan(0);
  });

  it('marks a strong password as meeting every requirement', () => {
    render(
      <PasswordInput
        value="Corr3ct-Horse!Battery"
        onChange={() => {}}
        aria-label="New password"
        showRequirements
        minLength={12}
      />,
    );

    expect(screen.queryByText(/^Not met:$/)).not.toBeInTheDocument();
    expect(screen.getByText('Strong')).toBeInTheDocument();
  });

  it('renders no checklist when requirements are not requested', () => {
    render(<PasswordInput value="anything" onChange={() => {}} aria-label="Password" />);
    expect(screen.queryByText(/At least/)).not.toBeInTheDocument();
  });
});

describe('SwitchField', () => {
  it('links its label and hint to the switch and reports checked state', async () => {
    const onChange = vi.fn();
    render(
      <SwitchField
        label="Allow guest checkout"
        hint="Shoppers can order without an account"
        checked={false}
        onCheckedChange={onChange}
      />,
    );

    const toggle = screen.getByRole('switch', { name: /allow guest checkout/i });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    const describedBy = toggle.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      'Shoppers can order without an account',
    );

    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('StatusBadge', () => {
  it('renders a human label rather than the raw enum value', () => {
    render(<StatusBadge status="PARTIALLY_REFUNDED" />);
    expect(screen.getByText('Part refunded')).toBeInTheDocument();
  });

  it('conveys status as text, so colour is never the only signal', () => {
    const { container } = render(<StatusBadge status="CANCELLED" />);
    expect(container.textContent?.trim()).toBe('Cancelled');
  });

  it('degrades gracefully for an unmapped value', () => {
    render(<StatusBadge status="SOME_NEW_STATE" />);
    expect(screen.getByText('Some new state')).toBeInTheDocument();
  });

  it('renders a dash for a missing status rather than an empty badge', () => {
    const { container } = render(<StatusBadge status={null} />);
    expect(container.textContent).toBe('-');
  });
});

describe('Badge', () => {
  it('renders its children', () => {
    render(<Badge tone="accent">Featured</Badge>);
    expect(screen.getByText('Featured')).toBeInTheDocument();
  });
});
