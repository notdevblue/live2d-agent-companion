// Integration test: creates only unmapped windows owned by this process.
#include <X11/Xatom.h>
#include <X11/Xlib.h>
#include <X11/extensions/shape.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

typedef struct { pid_t pid; FILE *input; FILE *output; } Child;
static Display *display;
static const char *binary;
static void require(int condition, const char *message) {
  if (!condition) { fprintf(stderr, "X11 input test: %s\n", message); exit(1); }
}
static Child start(Window window, unsigned long pid) {
  int input[2], output[2];
  require(pipe(input) == 0 && pipe(output) == 0, "pipe");
  pid_t child = fork();
  require(child >= 0, "fork");
  if (!child) {
    dup2(input[0], STDIN_FILENO); dup2(output[1], STDOUT_FILENO);
    close(input[0]); close(input[1]); close(output[0]); close(output[1]);
    // Do not keep the test parent's X11 connection open in the helper.
    close(ConnectionNumber(display));
    char xid[32], owner[32];
    snprintf(xid, sizeof(xid), "%lu", window);
    snprintf(owner, sizeof(owner), "%lu", pid);
    execl(binary, binary, xid, owner, (char *)NULL);
    _exit(127);
  }
  close(input[0]); close(output[1]);
  Child result = { child, fdopen(input[1], "w"), fdopen(output[0], "r") };
  require(result.input != NULL && result.output != NULL, "fdopen");
  return result;
}
static void line(Child *child, const char *expected) {
  char result[128];
  require(fgets(result, sizeof(result), child->output) != NULL && !strcmp(result, expected), "helper acknowledgement");
}
static void command(Child *child, const char *data) {
  require(fputs(data, child->input) >= 0 && fflush(child->input) == 0, "write command");
}
static void finish(Child *child, int expected) {
  fclose(child->input); fclose(child->output);
  int status;
  require(waitpid(child->pid, &status, 0) == child->pid, "waitpid");
  require(WIFEXITED(status) && WEXITSTATUS(status) == expected, "helper exit code");
}
static void shape(Window window, int kind, int x, int y, int width, int height) {
  int count, ordering;
  XRectangle *rectangles = XShapeGetRectangles(display, window, kind, &count, &ordering);
  int matches = count == 1 && rectangles && rectangles[0].x == x && rectangles[0].y == y &&
    rectangles[0].width == width && rectangles[0].height == height;
  if (rectangles) XFree(rectangles);
  require(matches, kind == ShapeInput ? "input region" : "visual shape must remain unchanged");
}
int main(int argc, char **argv) {
  require(argc == 2, "helper path required"); binary = argv[1];
  alarm(15);
  display = XOpenDisplay(NULL); require(display != NULL, "DISPLAY unavailable");
  Window own = XCreateSimpleWindow(display, DefaultRootWindow(display), 0, 0, 200, 100, 0, 0, 0);
  Window foreign = XCreateSimpleWindow(display, DefaultRootWindow(display), 0, 0, 200, 100, 0, 0, 0);
  unsigned long pid = (unsigned long)getpid(), other_pid = pid + 1;
  Atom property = XInternAtom(display, "_NET_WM_PID", False);
  XChangeProperty(display, own, property, XA_CARDINAL, 32, PropModeReplace, (unsigned char *)&pid, 1);
  XChangeProperty(display, foreign, property, XA_CARDINAL, 32, PropModeReplace, (unsigned char *)&other_pid, 1);
  XSync(display, False);

  Child valid = start(own, pid); line(&valid, "ready\n");
  command(&valid, "10 10 1\n2 3 5 4\n"); line(&valid, "ok\n");
  shape(own, ShapeInput, 40, 30, 100, 40);
  shape(own, ShapeBounding, 0, 0, 200, 100);
  // A fully transparent frame may have no input region at all.
  command(&valid, "10 10 0\n"); line(&valid, "ok\n");
  int count, ordering;
  XRectangle *empty = XShapeGetRectangles(display, own, ShapeInput, &count, &ordering);
  if (empty) XFree(empty);
  require(count == 0, "empty input region");
  finish(&valid, 0);
  shape(own, ShapeInput, 0, 0, 200, 100);

  Child malformed = start(own, pid); line(&malformed, "ready\n");
  command(&malformed, "10 10 1\n2 3 5 4\n"); line(&malformed, "ok\n");
  command(&malformed, "10 10 4097\n"); finish(&malformed, 4);
  shape(own, ShapeInput, 0, 0, 200, 100);
  shape(own, ShapeBounding, 0, 0, 200, 100);

  Child outside = start(own, pid); line(&outside, "ready\n");
  command(&outside, "10 10 1\n9 0 2 1\n"); finish(&outside, 4);
  shape(own, ShapeInput, 0, 0, 200, 100);

  Child wrong_parent = start(own, other_pid); finish(&wrong_parent, 2);
  Child wrong_owner = start(foreign, pid); finish(&wrong_owner, 3);
  shape(foreign, ShapeInput, 0, 0, 200, 100);
  XDestroyWindow(display, own); XDestroyWindow(display, foreign); XCloseDisplay(display);
  puts("X11 input helper: shape/scaling/visual isolation/cleanup/bounds/ownership passed");
  return 0;
}
