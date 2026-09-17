import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

export const adminGuard: CanActivateFn = () => {
  const router = inject(Router);
  return localStorage.getItem('loggedInRole') === 'admin'
    ? true
    : router.createUrlTree(['/inspection']);
};
