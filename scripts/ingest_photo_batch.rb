#!/usr/bin/env ruby

require "csv"
require "fileutils"
require "open3"
require "optparse"
require "shellwords"
require "time"

IMAGE_EXTENSIONS = [".jpg", ".jpeg"].freeze
PREFIX = "mkjr"
DEFAULT_SOURCE_DIR = "public/to sort"
DEFAULT_DEST_DIR = "public/photos"
MANIFEST_PATH = "photo-rename-manifest.csv"
MANIFEST_HEADERS = ["old_path", "new_path", "capture_timestamp", "capture_date", "camera_slug", "make", "model", "width", "height"].freeze

CAMERA_SLUG_OVERRIDES = {
  "Canon EOS 7D" => "canon-eos-7d",
  "Canon EOS 6D" => "canon-eos-6d",
  "Canon EOS 6D Mark II" => "canon-eos-6d-mark-ii",
  "ILCE-7CM2" => "sony-ilce-7cm2",
  "iPhone 12 Pro" => "iphone-12-pro",
  "DMC-GF7" => "panasonic-dmc-gf7",
  "EZ Controller" => "noritsu-scan",
  "QSS-32_33" => "noritsu-scan"
}.freeze

def parse_options(argv)
  options = {
    apply: false,
    source_dir: DEFAULT_SOURCE_DIR,
    dest_dir: DEFAULT_DEST_DIR
  }

  OptionParser.new do |parser|
    parser.banner = "Usage: ruby scripts/ingest_photo_batch.rb [--apply] [--source DIR] [--dest DIR]"

    parser.on("--apply", "Rename and move files, append manifest rows, and write an undo script") do
      options[:apply] = true
    end

    parser.on("--source DIR", "Source directory to ingest from (default: #{DEFAULT_SOURCE_DIR})") do |value|
      options[:source_dir] = value
    end

    parser.on("--dest DIR", "Destination directory for renamed photos (default: #{DEFAULT_DEST_DIR})") do |value|
      options[:dest_dir] = value
    end
  end.parse!(argv)

  options
end

def mdls_value(path, key)
  stdout, status = Open3.capture2("mdls", "-raw", "-name", key, path)
  raise "mdls failed for #{path} (#{key})" unless status.success?

  stdout.strip
end

def slugify(value)
  slug = value.to_s.downcase.gsub(/[^a-z0-9]+/, "-").gsub(/\A-+|-+\z/, "")
  slug.empty? ? "unknown-camera" : slug
end

def camera_slug(make, model)
  return CAMERA_SLUG_OVERRIDES[model] if CAMERA_SLUG_OVERRIDES.key?(model)

  combined = [make, model]
    .reject { |part| part.nil? || part.empty? || part == "(null)" }
    .join(" ")

  slugify(combined)
end

def capture_date(raw_date, path)
  return raw_date[0, 10].delete("-") unless raw_date.nil? || raw_date.empty? || raw_date == "(null)"

  File.mtime(path).strftime("%Y%m%d")
end

def capture_timestamp(raw_date, path)
  return raw_date unless raw_date.nil? || raw_date.empty? || raw_date == "(null)"

  File.mtime(path).utc.strftime("%Y-%m-%d %H:%M:%S +0000")
end

def image_files(source_dir)
  Dir.glob(File.join(source_dir, "**", "*"), File::FNM_CASEFOLD)
    .select { |path| File.file?(path) && IMAGE_EXTENSIONS.include?(File.extname(path).downcase) }
    .sort
end

def existing_sequence_index(dest_dir)
  sequences = Hash.new(0)

  Dir.glob(File.join(dest_dir, "*.jpg")).sort.each do |path|
    basename = File.basename(path)
    match = basename.match(/^#{PREFIX}_(\d{8})_(.+)_(\d{3})\.jpg$/i)
    next unless match

    capture_date = match[1]
    camera_slug = match[2]
    sequence = match[3].to_i
    key = [capture_date, camera_slug]
    sequences[key] = [sequences[key], sequence].max
  end

  sequences
end

def build_plan(source_dir, dest_dir)
  files = image_files(source_dir)
  sequence_index = existing_sequence_index(dest_dir)

  rows = files.map do |path|
    raw_date = mdls_value(path, "kMDItemContentCreationDate")
    make = mdls_value(path, "kMDItemAcquisitionMake")
    model = mdls_value(path, "kMDItemAcquisitionModel")
    width = mdls_value(path, "kMDItemPixelWidth")
    height = mdls_value(path, "kMDItemPixelHeight")
    resolved_capture_date = capture_date(raw_date, path)
    resolved_camera_slug = camera_slug(make, model)

    {
      old_path: path,
      old_name: File.basename(path),
      capture_date: resolved_capture_date,
      capture_timestamp: capture_timestamp(raw_date, path),
      make: make,
      model: model,
      width: width,
      height: height,
      camera_slug: resolved_camera_slug,
      sequence_key: [resolved_capture_date, resolved_camera_slug]
    }
  end

  grouped_rows = rows.group_by { |row| row[:sequence_key] }
  planned = grouped_rows.values.flat_map do |group|
    key = group.first[:sequence_key]
    start_sequence = sequence_index[key]

    group
      .sort_by { |row| [row[:capture_timestamp], row[:old_name].downcase] }
      .each_with_index.map do |row, index|
        sequence = format("%03d", start_sequence + index + 1)
        filename = "#{PREFIX}_#{row[:capture_date]}_#{row[:camera_slug]}_#{sequence}.jpg"

        row.merge(
          new_name: filename,
          new_path: File.join(dest_dir, filename),
          manifest_new_path: filename
        )
      end
  end

  duplicates = planned.group_by { |row| row[:new_path] }.select { |_target, group| group.length > 1 }
  raise "Duplicate target names detected: #{duplicates.keys.join(', ')}" unless duplicates.empty?

  existing_targets = planned.select { |row| File.exist?(row[:new_path]) }
  unless existing_targets.empty?
    raise "Target files already exist: #{existing_targets.map { |row| row[:new_path] }.join(', ')}"
  end

  planned.sort_by { |row| row[:old_path].downcase }
end

def append_manifest(plan)
  existing_manifest = File.exist?(MANIFEST_PATH)

  CSV.open(MANIFEST_PATH, existing_manifest ? "a" : "w") do |csv|
    csv << MANIFEST_HEADERS unless existing_manifest

    plan.each do |row|
      csv << [
        row[:old_path],
        row[:manifest_new_path],
        row[:capture_timestamp],
        row[:capture_date],
        row[:camera_slug],
        row[:make],
        row[:model],
        row[:width],
        row[:height]
      ]
    end
  end
end

def write_undo_script(plan)
  timestamp = Time.now.utc.strftime("%Y%m%d%H%M%S")
  undo_path = "photo-ingest-undo-#{timestamp}.sh"
  lines = ["#!/usr/bin/env bash", "set -euo pipefail"]

  plan.reverse_each do |row|
    lines << "mkdir -p #{Shellwords.escape(File.dirname(row[:old_path]))}"
    lines << "mv #{Shellwords.escape(row[:new_path])} #{Shellwords.escape(row[:old_path])}"
  end

  File.write(undo_path, lines.join("\n") + "\n")
  File.chmod(0o755, undo_path)
  undo_path
end

def apply_plan(plan)
  plan.each do |row|
    FileUtils.mkdir_p(File.dirname(row[:new_path]))
    FileUtils.mv(row[:old_path], row[:new_path])
  end
end

options = parse_options(ARGV)
plan = build_plan(options[:source_dir], options[:dest_dir])

if plan.empty?
  puts "No JPG/JPEG files found in #{options[:source_dir]}."
  exit 0
end

plan.each do |row|
  puts "#{row[:old_path]} -> #{row[:new_path]}"
end

unless options[:apply]
  puts
  puts "Dry run only. Re-run with --apply to ingest #{plan.length} files."
  exit 0
end

undo_path = write_undo_script(plan)
apply_plan(plan)
append_manifest(plan)

puts
puts "Ingested #{plan.length} files."
puts "Manifest: #{MANIFEST_PATH}"
puts "Undo script: #{undo_path}"
