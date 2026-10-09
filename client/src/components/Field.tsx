import { useId, type ChangeEvent, type InputHTMLAttributes, type ReactNode } from 'react';

interface BaseProps {
  label: ReactNode;
  name: string;
  error?: string;
  hint?: ReactNode;
  optional?: boolean;
}

function describedBy(id: string, hint?: ReactNode, error?: string) {
  return [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
}

function Wrapper({ id, label, hint, error, optional, children }: BaseProps & { id: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} {optional && <span className="field__optional">(optional)</span>}
      </label>
      {hint && (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p className="field__error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

type TextFieldProps = BaseProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'name' | 'onChange' | 'value'> & {
    value: string;
    onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  };

export function TextField({ label, name, error, hint, optional, ...rest }: TextFieldProps) {
  const id = useId();
  return (
    <Wrapper id={id} label={label} name={name} error={error} hint={hint} optional={optional}>
      <input
        id={id}
        name={name}
        className="input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        required={!optional && rest.readOnly !== true ? true : undefined}
        {...rest}
      />
    </Wrapper>
  );
}

interface TextAreaFieldProps extends BaseProps {
  value: string;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
}

export function TextAreaField({ label, name, error, hint, optional, ...rest }: TextAreaFieldProps) {
  const id = useId();
  return (
    <Wrapper id={id} label={label} name={name} error={error} hint={hint} optional={optional}>
      <textarea
        id={id}
        name={name}
        className="textarea"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        required={!optional || undefined}
        {...rest}
      />
    </Wrapper>
  );
}

interface SelectFieldProps extends BaseProps {
  value: string;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
}

export function SelectField({ label, name, error, hint, optional, options, placeholder, ...rest }: SelectFieldProps) {
  const id = useId();
  return (
    <Wrapper id={id} label={label} name={name} error={error} hint={hint} optional={optional}>
      <select
        id={id}
        name={name}
        className="select"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...rest}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Wrapper>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="notice notice--error" role="alert">
      <div>{message}</div>
    </div>
  );
}
