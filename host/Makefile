# Host render of the pedal's NAM → Arrakis chain (render.cpp). Not part of the
# firmware build: uses the A2-Lite Cortex-M7 engine's C tiles, as its own host
# tests do, with the pedal's block size.
CXX     ?= c++
CC      ?= cc
CFLAGS  ?= -O2
A2LITE  = ../embedded/engines/cortex-m7/a2lite
NAMB    = ../embedded/namb
DEFS    = -DNAM_A2LITE_MAX_BUFFER_SIZE=48

render: render.cpp ../arrakis.h $(A2LITE)/nam_a2lite.c $(NAMB)/namb_reader.c
	$(CC) $(CFLAGS) $(DEFS) -I$(A2LITE) -I$(NAMB) -c $(A2LITE)/nam_a2lite.c -o nam_a2lite.o
	$(CC) $(CFLAGS) $(DEFS) -I$(NAMB) -c $(NAMB)/namb_reader.c -o namb_reader.o
	$(CXX) $(CFLAGS) -std=c++17 $(DEFS) -I$(A2LITE) -I$(NAMB) render.cpp nam_a2lite.o namb_reader.o -lm -o $@

clean:
	rm -f render *.o

.PHONY: clean
