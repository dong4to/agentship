export function isAdmin(user) {
  return Boolean(user) && user.role === 'admin';
}

export function canRefund(user, order) {
  return isAdmin(user) || order.customer === user?.id;
}
