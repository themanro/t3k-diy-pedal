// host/render.cpp — hear the pedal's NAM → Arrakis chain on a computer.
//
// Runs a .namb capture through the same A2-Lite engine the pedal uses (its C
// tiles on a host), then arrakis.h, in the pedal's 48-frame blocks, and
// writes 48 kHz mono WAVs. Without an input file it plays a synthesized
// guitar DI (plucked strings), so no recording is needed:
//
//   make -C host && host/render embedded/weights/a2lite.namb out/       [di.raw]
//
// di.raw, if given, is headerless mono float32 at 48 kHz. Writes di.wav,
// nam.wav and nam_arrakis_<mix>.wav. It also checks that Arrakis at Mix 0
// leaves the NAM output untouched, bit for bit.
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

extern "C" {
#include "nam_a2lite.h"
#include "namb_reader.h"
}
#include "../arrakis.h"

static constexpr float kRate  = 48000.0f;
static constexpr int   kBlock = 48; // the pedal's audio block

static std::vector<uint8_t> ReadFile(const char* path)
{
    std::vector<uint8_t> data;
    FILE*                f = fopen(path, "rb");
    if(!f)
        return data;
    uint8_t chunk[65536];
    size_t  n;
    while((n = fread(chunk, 1, sizeof chunk, f)) > 0)
        data.insert(data.end(), chunk, chunk + n);
    fclose(f);
    return data;
}

static void WriteWav(const std::string& path, const std::vector<float>& x, float peak_to)
{
    float peak = 1e-9f;
    for(float v : x)
        peak = fmaxf(peak, fabsf(v));
    const float g = peak_to / peak; // same peak for every file, for fair listening
    FILE*       f = fopen(path.c_str(), "wb");
    if(!f)
    {
        fprintf(stderr, "can't write %s\n", path.c_str());
        exit(1);
    }
    const uint32_t bytes = (uint32_t)x.size() * 2, rate = (uint32_t)kRate;
    auto u32 = [&](uint32_t v) { fwrite(&v, 4, 1, f); };
    auto u16 = [&](uint16_t v) { fwrite(&v, 2, 1, f); };
    fwrite("RIFF", 1, 4, f), u32(36 + bytes), fwrite("WAVEfmt ", 1, 8, f);
    u32(16), u16(1), u16(1), u32(rate), u32(rate * 2), u16(2), u16(16);
    fwrite("data", 1, 4, f), u32(bytes);
    for(float v : x)
    {
        const float   s = fmaxf(-1.0f, fminf(1.0f, v * g));
        const int16_t q = (int16_t)lrintf(s * 32767.0f);
        fwrite(&q, 2, 1, f);
    }
    fclose(f);
    printf("  %s  (peak %.3f before normalizing)\n", path.c_str(), peak);
}

// A plucked-string riff (Karplus-Strong): low notes, then a ringing chord, so
// both the moving and the sustained drone can be heard.
static std::vector<float> SynthDi()
{
    struct Note { float t, hz, len; };
    const Note notes[] = {{0.0f, 82.41f, 0.45f}, {0.5f, 82.41f, 0.45f}, {1.0f, 98.00f, 0.45f},
                          {1.5f, 110.0f, 0.9f},  {2.5f, 82.41f, 0.45f}, {3.0f, 73.42f, 0.9f},
                          {4.2f, 82.41f, 5.0f},  {4.21f, 123.47f, 5.0f}, {4.22f, 164.81f, 5.0f}};
    std::vector<float> out((size_t)(10.0f * kRate), 0.0f);
    uint32_t           seed = 12345;
    for(const Note& n : notes)
    {
        const int          period = (int)(kRate / n.hz);
        std::vector<float> line(period);
        for(float& v : line)
        {
            seed = seed * 1664525u + 1013904223u;
            v    = ((seed >> 9) * (1.0f / 8388608.0f)) - 1.0f;
        }
        const size_t start = (size_t)(n.t * kRate), len = (size_t)(n.len * kRate);
        float        prev  = 0.0f;
        for(size_t i = 0; i < len && start + i < out.size(); i++)
        {
            const int   k = (int)(i % period);
            const float v = line[k];
            line[k]       = 0.996f * 0.5f * (v + prev);
            prev          = v;
            const float fade = i + 2000 > len ? (float)(len - i) / 2000.0f : 1.0f; // palm the note off
            out[start + i] += 0.12f * v * fade;
        }
    }
    return out;
}

int main(int argc, char** argv)
{
    if(argc < 3)
    {
        fprintf(stderr, "usage: render capture.namb outdir/ [di.raw]\n");
        return 2;
    }
    std::vector<uint8_t> namb = ReadFile(argv[1]);
    namb_model_t         m;
    namb_status_t        st = namb_parse(namb.data(), namb.size(), &m);
    if(st == NAMB_OK)
        st = namb_check_a2lite(&m);
    if(st != NAMB_OK)
    {
        fprintf(stderr, "%s: %s (only A2-Lite captures run on the pedal)\n", argv[1], namb_status_str(st));
        return 1;
    }

    static nam_a2lite_weights_t w;
    static nam_a2lite_t         inst;
    static nam_a2lite_state_t   state;
    if(nam_a2lite_load_weights(&w, m.weights, (int)m.weight_count) != 0)
    {
        fprintf(stderr, "weight count mismatch\n");
        return 1;
    }

    std::vector<float> di;
    if(argc > 3)
    {
        std::vector<uint8_t> raw = ReadFile(argv[3]);
        di.resize(raw.size() / 4);
        memcpy(di.data(), raw.data(), di.size() * 4);
    }
    else
        di = SynthDi();
    di.resize((di.size() / kBlock) * kBlock);

    // NAM, in the pedal's blocks.
    nam_a2lite_init(&inst, &w, &state);
    nam_a2lite_prewarm(&inst);
    std::vector<float> nam(di.size());
    for(size_t i = 0; i < di.size(); i += kBlock)
    {
        const float* in[1]  = {&di[i]};
        float*       out[1] = {&nam[i]};
        nam_a2lite_process(&inst, in, out, kBlock);
    }

    const std::string dir = argv[2];
    printf("%s: %zu samples (%.1f s)\n", argv[1], di.size(), di.size() / kRate);
    WriteWav(dir + "/di.wav", di, 0.5f);
    WriteWav(dir + "/nam.wav", nam, 0.5f);

    // Arrakis after NAM at a few Mix settings (Detune at its default).
    static Arrakis ar; // 32 KB: static, as on the pedal
    for(float mix : {0.0f, 0.35f, 0.6f, 1.0f})
    {
        ar.Init(kRate);
        ar.SetDetune(0.63f);
        ar.SetMix(mix);
        ar.Process(nullptr, 0); // settle the Mix ramp before audio
        std::vector<float> x = nam;
        for(size_t i = 0; i < x.size(); i += kBlock)
            ar.Process(&x[i], kBlock);
        if(mix == 0.0f)
        {
            const bool same = memcmp(x.data(), nam.data(), x.size() * 4) == 0;
            printf("  Mix 0 leaves the NAM output bit-identical: %s\n", same ? "yes" : "NO");
            if(!same)
                return 1;
            continue;
        }
        char name[64];
        snprintf(name, sizeof name, "/nam_arrakis_%02d.wav", (int)lrintf(mix * 100.0f));
        WriteWav(dir + name, x, 0.5f);
    }
    return 0;
}
