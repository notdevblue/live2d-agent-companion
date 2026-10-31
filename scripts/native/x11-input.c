// The parent may only change the INPUT shape of its own fixed X11 window.
#include <X11/Xatom.h>
#include <X11/Xlib.h>
#include <X11/extensions/shape.h>
#include <errno.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

#define MAX_RECTS 4096
#define MAX_SIZE 8192
static int x_failed = 0;
static int x_error(Display *display, XErrorEvent *event) {
  (void)display; (void)event;
  x_failed = 1;
  return 0;
}
static int owned(Display *display, Window window, unsigned long pid) {
  Atom actual; int format; unsigned long count, remaining; unsigned char *data = NULL;
  int status = XGetWindowProperty(display, window, XInternAtom(display, "_NET_WM_PID", False),
    0, 1, False, XA_CARDINAL, &actual, &format, &count, &remaining, &data);
  int valid = status == Success && actual == XA_CARDINAL && format == 32 && count == 1 &&
    data && *(unsigned long *)data == pid;
  if (data) XFree(data);
  XSync(display, False);
  return valid && !x_failed;
}
static unsigned long number(const char *value) {
  char *end; errno = 0;
  unsigned long result = strtoul(value, &end, 10);
  return errno || !*value || *end ? 0 : result;
}
int main(int argc, char **argv) {
  if (argc != 3) return 2;
  unsigned long window_id = number(argv[1]), pid = number(argv[2]);
  if (!window_id || window_id > UINT32_MAX || !pid || pid > INT_MAX || (unsigned long)getppid() != pid)
    return 2;
  Display *display = XOpenDisplay(NULL);
  if (!display) return 3;
  XSetErrorHandler(x_error);
  int event_base, error_base, major, minor;
  if (!XShapeQueryExtension(display, &event_base, &error_base) ||
      !XShapeQueryVersion(display, &major, &minor) || major < 1 || (major == 1 && minor < 1) ||
      !owned(display, window_id, pid)) { XCloseDisplay(display); return 3; }
  puts("ready"); fflush(stdout);
  char line[256], extra;
  XRectangle rects[MAX_RECTS];
  int failed = 0;
  while (fgets(line, sizeof(line), stdin)) {
    unsigned width, height, count;
    if (sscanf(line, "%u %u %u %c", &width, &height, &count, &extra) != 3 ||
        !width || !height || width > MAX_SIZE || height > MAX_SIZE || count > MAX_RECTS) { failed = 1; break; }
    for (unsigned i = 0; i < count; i++) {
      int x, y; unsigned w, h;
      if (!fgets(line, sizeof(line), stdin) || sscanf(line, "%d %d %u %u %c", &x, &y, &w, &h, &extra) != 4 ||
          x < 0 || y < 0 || !w || !h || (unsigned)x >= width || (unsigned)y >= height ||
          w > width - (unsigned)x || h > height - (unsigned)y) { failed = 1; break; }
      rects[i] = (XRectangle){ (short)x, (short)y, (unsigned short)w, (unsigned short)h };
    }
    if (failed || !owned(display, window_id, pid)) { failed = 1; break; }
    XWindowAttributes attrs;
    if (!XGetWindowAttributes(display, window_id, &attrs) || attrs.width <= 0 || attrs.height <= 0 ||
        attrs.width > MAX_SIZE || attrs.height > MAX_SIZE) { failed = 1; break; }
    // Electron reports DIP, whereas XShape coordinates are native X11 pixels.
    // Round outwards so fractional scaling never makes thin visible edges unclickable.
    for (unsigned i = 0; i < count; i++) {
      int right = ((rects[i].x + rects[i].width) * attrs.width + (int)width - 1) / (int)width;
      int bottom = ((rects[i].y + rects[i].height) * attrs.height + (int)height - 1) / (int)height;
      rects[i].x = (short)(rects[i].x * attrs.width / (int)width);
      rects[i].y = (short)(rects[i].y * attrs.height / (int)height);
      rects[i].width = (unsigned short)(right - rects[i].x);
      rects[i].height = (unsigned short)(bottom - rects[i].y);
    }
    XShapeCombineRectangles(display, window_id, ShapeInput, 0, 0, rects, (int)count, ShapeSet, Unsorted);
    XSync(display, False);
    if (x_failed) { failed = 1; break; }
    puts("ok"); fflush(stdout);
  }
  // Normal parent shutdown/recreation restores default input. No visual shape
  // is ever changed, including on malformed input or a destroyed window.
  if (owned(display, window_id, pid)) {
    XShapeCombineMask(display, window_id, ShapeInput, 0, 0, None, ShapeSet);
    XSync(display, False);
  }
  XCloseDisplay(display);
  return failed ? 4 : 0;
}
