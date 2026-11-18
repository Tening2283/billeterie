import { useMutation } from '@tanstack/react-query';
import type { DemoLoginInput } from '@billetterie/shared';
import { errorMessage } from '../lib/api';
import { api } from '../lib/endpoints';
import { sessionStore } from '../lib/session';
import { useToast } from '../lib/toast';

const roleLabel: Record<DemoLoginInput['role'], string> = {
  traveler: 'voyageur',
  controller: 'contrôleur',
};

/** « Essayer en voyageur / en contrôleur » : connexion à un compte de démo en un clic. */
export function useDemoLogin(onSuccess?: (role: DemoLoginInput['role']) => void) {
  const toast = useToast();
  return useMutation({
    mutationFn: (role: DemoLoginInput['role']) => api.demo({ role }),
    onSuccess: (session, role) => {
      sessionStore.set(session);
      toast.show(`Connecté en ${roleLabel[role]} de démo.`, 'success');
      onSuccess?.(role);
    },
    onError: (error) => toast.show(errorMessage(error), 'error'),
  });
}
