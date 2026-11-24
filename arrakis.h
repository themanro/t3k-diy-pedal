// arrakis.h — Arrakis: a detuned sub-octave drone, after the amp.
//
// Ported from the MS-70CDR effect in themanro/ZoomMultistompZDL
// (src/custom/arrakis/arrakis.c, MIT, Copyright (c) 2026 Roman Rusinov).
//
// Two granular pitch voices read the input one octave down from a ring
// buffer, detuned in opposite directions by a slow LFO so they beat against
// each other; each is driven into a soft clipper and darkened by a one-pole
// low-pass. On the Zoom the voices went left and right; this pedal is mono,
// so they are summed and the beating becomes a slow throb.
//
//   Detune: how far the two voices drift apart (0 to ±60 cents)
//   Mix:    dry/wet; 0 is the pedal without Arrakis
//
// The Zoom build ran at 44.1 kHz; grain length, LFO rate and filter corner
// are scaled by the sample rate so it sounds the same here. Header-only,
// no allocation: one instance holds a 32 KB ring.
#pragma once
#include <math.h>
#include <stddef.h>
#include <stdint.h>

class Arrakis
{
  public:
    void Init(float sample_rate)
    {
        const float scale = sample_rate / 44100.0f;
        grain_            = 4096.0f * scale; // ~93 ms grains, as on the Zoom
        half_             = 0.5f * grain_;
        inv_half_         = 1.0f / half_;
        lfo_inc_          = kTwoPi * 0.15f / sample_rate;               // ~0.15 Hz sweep
        lp_a_             = powf(0.89f, 44100.0f / sample_rate);         // ~800 Hz: exactly the Zoom's 0.89 at 44.1 kHz
        for(uint32_t i = 0; i < kBuf; i++)
            buf_[i] = 0.0f;
        wp_ = 0;
        pa_ = 0.0f;
        pb_ = half_;
        lfo_ = lp_a_state_ = lp_b_state_ = 0.0f;
    }

    void SetDetune(float v) { detune_amp_ = Clamp01(v) * 60.0f * (0.69314718f / 1200.0f); }
    void SetMix(float v) { mix_target_ = Clamp01(v); }
    float Mix() const { return mix_target_; }

    // In place on a mono block.
    void Process(float* x, size_t n)
    {
        // Mix ramps to its new value across the block, so turning it doesn't click.
        const float step = n ? (mix_target_ - mix_) / (float)n : 0.0f;
        for(size_t i = 0; i < n; i++)
        {
            mix_ += step;
            const float wet = mix_, dry = 1.0f - mix_;
            const float in = x[i];
            buf_[wp_]      = in;

            lfo_ += lfo_inc_;
            if(lfo_ > kTwoPi)
                lfo_ -= kTwoPi;
            const float off = detune_amp_ * Sine(lfo_);
            const float va  = Voice(pa_, 0.5f * (1.0f + off));
            const float vb  = Voice(pb_, 0.5f * (1.0f - off));

            lp_a_state_ = (1.0f - lp_a_) * Soft(va * kDrive) + lp_a_ * lp_a_state_;
            lp_b_state_ = (1.0f - lp_a_) * Soft(vb * kDrive) + lp_a_ * lp_b_state_;

            x[i] = dry * in + wet * 0.5f * (lp_a_state_ + lp_b_state_);

            if(++wp_ >= kBuf)
                wp_ = 0;
        }
        mix_ = mix_target_;
    }

  private:
    static constexpr uint32_t kBuf   = 8192; // > the longest grain at 48 kHz (4,458)
    static constexpr float    kTwoPi = 6.28318530718f;
    static constexpr float    kDrive = 2.5f;

    // The Zoom build's polynomial sine (|error| < 0.001), cheaper than sinf.
    static float Sine(float x)
    {
        constexpr float pi = 3.14159265359f;
        x -= kTwoPi * (float)(int)(x * 0.15915494309f);
        if(x < -pi)
            x += kTwoPi;
        if(x > pi)
            x -= kTwoPi;
        const float y = 1.2732395447f * x - 0.4052847346f * x * fabsf(x);
        return y + 0.225f * (y * fabsf(y) - y);
    }
    static float Clamp01(float v) { return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v); }
    static float Soft(float x)
    {
        if(x > 1.0f)
            return 1.0f;
        if(x < -1.0f)
            return -1.0f;
        return 1.5f * x - 0.5f * x * x * x;
    }

    // Linearly interpolated read d samples behind the write head.
    float Read(float d) const
    {
        const int   di  = (int)d;
        const float fr  = d - (float)di;
        int         idx = (int)wp_ - di;
        if(idx < 0)
            idx += (int)kBuf;
        int prev = idx - 1;
        if(prev < 0)
            prev += (int)kBuf;
        return buf_[idx] * (1.0f - fr) + buf_[prev] * fr;
    }

    // Two overlapping grains half a grain apart, each under a triangle window,
    // with the read point drifting at (1 - ratio) samples per sample.
    float Voice(float& p, float ratio)
    {
        float d2 = p + half_;
        if(d2 >= grain_)
            d2 -= grain_;
        const float e1 = (half_ - fabsf(half_ - p)) * inv_half_;
        const float e2 = (half_ - fabsf(half_ - d2)) * inv_half_;
        const float v  = Read(p) * e1 + Read(d2) * e2;
        p += 1.0f - ratio;
        if(p >= grain_)
            p -= grain_;
        else if(p < 0.0f)
            p += grain_;
        return v;
    }

    float    buf_[kBuf];
    uint32_t wp_         = 0;
    float    grain_      = 4096.0f, half_ = 2048.0f, inv_half_ = 1.0f / 2048.0f;
    float    lfo_inc_    = 0.0f, lp_a_ = 0.89f;
    float    pa_ = 0.0f, pb_ = 2048.0f, lfo_ = 0.0f, lp_a_state_ = 0.0f, lp_b_state_ = 0.0f;
    float    detune_amp_ = 0.63f * 60.0f * (0.69314718f / 1200.0f);
    float    mix_        = 0.0f, mix_target_ = 0.0f;
};
