import { useEffect } from 'react';

/** Sets the tab title. Admin pages add " · Admin" via PageHeader; public pages pass their own. */
export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}
