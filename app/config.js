// Public settings for /app. A Google client ID is meant to be public: it names the app
// to Google and grants nothing. The dev server answers this path with its own version.
window.FW_APP = {
  googleClientId: '',
  moduleLabels: {
    clients: 'Clients', invoice: 'Raise invoices', deliveries: 'Deliveries', driver: 'Driver run',
    workshop: 'Workshop', tracker: 'Sales tracker', monitor: 'Monitor', marketing: 'Marketing',
    catalog: 'Catalogue', studio: 'Studios', queue: 'Queue', admin: 'Admin'
  }
};
