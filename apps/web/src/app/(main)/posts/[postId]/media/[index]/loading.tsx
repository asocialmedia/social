// When navigating from the post detail page into the fullscreen viewer the
// media route renders the same post shell (ClientPost) with the viewer open.
// Showing a dedicated full-screen black overlay here would make that
// navigation read as a jarring third page swap. Instead we keep the post page
// visible and let the real viewer (with its own in-place asset skeleton)
// drive the loading state, so feed -> post -> media stays one connected flow.
export default function Loading() {
  return null;
}
