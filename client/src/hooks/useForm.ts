import { useState, type ChangeEvent } from 'react';
import type { z } from 'zod';
import { ApiError } from '../api/client';

type Values = Record<string, string | boolean>;

/**
 * Small form helper: controlled values, client-side Zod validation (same schemas
 * as the server), and mapping of server field errors back onto inputs.
 */
export function useForm<V extends Values>(initial: V) {
  const [values, setValues] = useState<V>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const field = (name: keyof V & string) => ({
    name,
    value: values[name] as string,
    error: errors[name],
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const target = e.target as HTMLInputElement;
      const v = target.type === 'checkbox' ? target.checked : target.value;
      setValues((prev) => ({ ...prev, [name]: v }));
      if (errors[name]) setErrors(({ [name]: _removed, ...rest }) => rest);
    },
  });

  function validate<S extends z.ZodType>(schema: S, input: unknown = values): z.output<S> | null {
    const r = schema.safeParse(input);
    if (r.success) return r.data;
    const fe: Record<string, string> = {};
    for (const i of r.error.issues) {
      const k = String(i.path[0] ?? '_');
      fe[k] ??= i.message;
    }
    setErrors(fe);
    setFormError('Please correct the highlighted fields.');
    return null;
  }

  async function submit<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await fn();
      setErrors({});
      return result;
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields ?? {});
        setFormError(err.message);
      } else {
        setFormError('Something went wrong. Please try again.');
      }
      return undefined;
    } finally {
      setSubmitting(false);
    }
  }

  return { values, setValues, errors, setErrors, formError, setFormError, submitting, field, validate, submit };
}
