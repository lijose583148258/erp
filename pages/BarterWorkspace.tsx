import BarterWorkspaceView from './BarterWorkspaceView';

/**
 * Legacy compatibility shell.
 * Keep the historical module path stable, but route all callers to the current implementation
 * so the system no longer maintains two divergent barter pages.
 */
export default BarterWorkspaceView;
