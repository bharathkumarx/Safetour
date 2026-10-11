import { Component } from 'react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const message = this.state.error?.message || 'Something went wrong';
      const fallback = this.props.fallback;
      if (fallback) {
        return fallback(this.state.error, this.handleReload);
      }
      return (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b1020',
          color: '#e2e8f0',
          padding: '2rem',
          textAlign: 'center',
          zIndex: 100,
        }}>
          <h2>Application Error</h2>
          <p style={{ margin: '0.5rem 0', maxWidth: '500px' }}>{message}</p>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              marginTop: '1rem',
              padding: '0.75rem 1.5rem',
              background: 'linear-gradient(135deg, #22c55e, #16a34a)',
              border: 'none',
              borderRadius: '10px',
              color: '#052e16',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;