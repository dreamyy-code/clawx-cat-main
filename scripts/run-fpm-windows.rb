require "rubygems"
require "fpm/command"

MSYS_TAR_EXE = "C:/Ruby34-x64/msys64/usr/bin/tar.exe"

class << File
  alias_method :clawx_orig_write, :write unless method_defined?(:clawx_orig_write)

  def write(path, *args, **kwargs)
    if Gem.win_platform?
      basename = File.basename(path.to_s)

      if basename == "debian-binary" && args.first == "2.0\n"
        return File.binwrite(path, "2.0\n")
      end

      if ["preinst", "postinst", "prerm", "postrm", "config"].include?(basename) && args.first.is_a?(String)
        return File.binwrite(path, args.first.gsub("\r\n", "\n"))
      end
    end

    clawx_orig_write(path, *args, **kwargs)
  end
end

module FPM
  module Util
    alias_method :clawx_orig_safesystem, :safesystem unless method_defined?(:clawx_orig_safesystem)

    def clawx_msys_path(path)
      str = path.to_s
      if str =~ /\A([A-Za-z]):[\\\/]?(.*)\z/
        drive = Regexp.last_match(1).downcase
        rest = Regexp.last_match(2).tr("\\", "/")
        return "/#{drive}/#{rest}"
      end
      str.tr("\\", "/")
    end

    def clawx_rewrite_tar_args(args)
      rewritten = [MSYS_TAR_EXE, "--format=gnu"]
      i = 1
      while i < args.length
        arg = args[i]
        rewritten << arg
        if ["-C", "-f", "-cf"].include?(arg) && i + 1 < args.length
          rewritten << clawx_msys_path(args[i + 1])
          i += 2
          next
        end
        i += 1
      end
      rewritten
    end

    def safesystem(*args)
      env = args.first.is_a?(Hash) ? args.shift.dup : {}
      command = args.first

      if Gem.win_platform? &&
         command == "C:/Windows/System32/tar.exe" &&
         !args.include?("--format=ar") &&
         args.include?("-cf")
        env["PATH"] = "C:\\Ruby34-x64\\msys64\\usr\\bin;#{env["PATH"] || ENV["PATH"]}"
        rewritten = clawx_rewrite_tar_args(args)
        return clawx_orig_safesystem(env, *rewritten)
      end

      return clawx_orig_safesystem(env, *args) unless env.empty?

      clawx_orig_safesystem(*args)
    end

    def program_in_path?(program)
      return false unless ENV["PATH"]

      envpath = ENV["PATH"].split(File::PATH_SEPARATOR)

      if Gem.win_platform?
        exts = ENV.fetch("PATHEXT", ".COM;.EXE;.BAT;.CMD").split(";")
        return envpath.any? do |p|
          base = File.join(p, program)
          File.executable?(base) || exts.any? do |ext|
            File.executable?("#{base}#{ext.downcase}") || File.executable?("#{base}#{ext.upcase}")
          end
        end
      end

      envpath.any? { |p| File.executable?(File.join(p, program)) }
    end

    def tar_cmd
      if Gem.win_platform?
        @@tar_cmd_deterministic = false unless defined? @@tar_cmd_deterministic
        return "C:/Windows/System32/tar.exe"
      end
      super
    end

    def ar_cmd
      if Gem.win_platform?
        @@ar_cmd_deterministic = false unless defined? @@ar_cmd_deterministic
        return ["C:/Windows/System32/tar.exe", "--format=ar", "-cf"]
      end
      super
    end
  end
end

if Gem.win_platform? && !ARGV.include?("--workdir")
  workdir = "C:/t"
  Dir.mkdir(workdir) unless Dir.exist?(workdir)
  ENV["TMP"] = workdir
  ENV["TEMP"] = workdir
  ARGV.unshift("--workdir", workdir)
end

exit(FPM::Command.run(ARGV))
