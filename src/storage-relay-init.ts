import { enableStorageNodeRelay } from './utils/storage-relay';

// Must run before the 0G SDK loads (browser bundle uses bundled axios → XHR).
enableStorageNodeRelay();